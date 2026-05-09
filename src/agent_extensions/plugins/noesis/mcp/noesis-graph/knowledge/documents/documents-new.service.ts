import { Inject, Injectable } from "@nestjs/common";
import { existsSync, readFileSync } from "fs";
import {
  AnalyzeDesignDraftOutputSchema,
  type AnalyzeDesignDraftOutput,
} from "../../../../shared-contracts/skills/analyze-design-draft/output.js";
import { DesignDocFileNewSchema } from "../../../../shared-contracts/design-doc-new.js";
import {
  DecisionFileNewSchema,
  TopicFileNewSchema,
  type DecisionFileNew,
  type DocumentFileNew,
  type TopicFileNew,
  type TopicItemRefNew,
} from "../../../../shared-contracts/source-file-schemas-new.js";
import {
  computeContentSha,
  computeFileSha,
  conversationJsonPath,
  decisionJsonPath,
  documentJsonPath,
  ensureNoesisLayout,
  topicJsonPath,
} from "../../../../shared-contracts/source-files.js";
import { PROJECT_DIR } from "../../config/config.module.js";
import { DecisionsRepositoryNew } from "../decisions/decisions-new.repository.js";
import { DesignDocsServiceNew } from "../design-docs/design-docs-new.service.js";
import { TopicsRepositoryNew } from "../topics/topics-new.repository.js";
import { DocumentsRepositoryNew } from "./documents-new.repository.js";

export interface MergeDocumentInput {
  outputJsonPath: string;
  designDocJsonPath: string | null;
}

export interface MergeDocumentResult {
  document_id: string;
  topic_paths: string[];
  decision_paths: string[];
  decision_attachments: number;
  design_doc_path: string | null;
}

export interface IndexFileOutcome {
  status: "indexed" | "unchanged";
  document_id: string;
}

@Injectable()
export class DocumentsServiceNew {
  constructor(
    @Inject(PROJECT_DIR) private readonly projectDir: string,
    private readonly repository: DocumentsRepositoryNew,
    private readonly topicsRepository: TopicsRepositoryNew,
    private readonly decisionsRepository: DecisionsRepositoryNew,
    private readonly designDocsService: DesignDocsServiceNew,
  ) {}

  async deleteForFile(
    absPath: string,
  ): Promise<{ document_id: string } | null> {
    const id = inferDocumentIdFromPath(absPath);
    if (id === null) return null;
    if (!(await this.repository.exists(id))) return null;
    await this.repository.delete(id);
    return { document_id: id };
  }

  async indexFile(absPath: string): Promise<IndexFileOutcome> {
    const sha = this.repository.fileSha(absPath);
    const file = this.repository.readFile(absPath);
    const stored = await this.repository.read(file.document_id);
    if (stored !== null && stored.sha === sha) {
      return { status: "unchanged", document_id: file.document_id };
    }
    await this.repository.upsert(file, sha);
    return { status: "indexed", document_id: file.document_id };
  }

  async listAllStoredFiles(): Promise<
    Array<{ id: string; path: string; sha: string }>
  > {
    return this.repository.listAllStoredFiles(this.projectDir);
  }

  async merge(input: MergeDocumentInput): Promise<MergeDocumentResult> {
    const output = this.loadOutput(input.outputJsonPath);
    this.validate(output, input.designDocJsonPath !== null);
    return this.split(output, input.designDocJsonPath);
  }

  // ----- private -----

  private loadOutput(path: string): AnalyzeDesignDraftOutput {
    if (!existsSync(path)) {
      throw new Error(`analyze-design-draft output not found at ${path}`);
    }
    const raw = readFileSync(path, "utf-8");
    return AnalyzeDesignDraftOutputSchema.parse(JSON.parse(raw));
  }

  private validate(
    output: AnalyzeDesignDraftOutput,
    expectsDesignDoc: boolean,
  ): void {
    const fragmentSet = new Set(output.fragments.map((f) => f.index));
    for (const topic of output.topics) {
      if (!topic.reviewed) {
        throw new Error(
          `Topic ${topic.id} is not marked reviewed; analyze-design-draft must complete the review pass before merge.`,
        );
      }
      for (const item of topic.items) {
        if (item.type === "document_fragment_ref") {
          if (item.document_id !== output.document.id) continue;
          // can't directly check by index from the ref shape, accept range alignment
          const matches = output.fragments.some(
            (f) =>
              f.start_offset === item.start_offset &&
              f.end_offset === item.end_offset,
          );
          if (!matches) {
            throw new Error(
              `Topic ${topic.id} references unknown fragment range ${item.start_offset}-${item.end_offset} in document ${output.document.id}.`,
            );
          }
        }
      }
    }
    for (const att of output.decision_attachments) {
      for (const fi of att.fragment_indices) {
        if (!fragmentSet.has(fi)) {
          throw new Error(
            `decision_attachments for ${att.decision_id} reference unknown fragment index ${fi}.`,
          );
        }
      }
    }
    if (expectsDesignDoc && output.design_doc_extracted !== true) {
      throw new Error(
        "Design doc path was supplied but design_doc_extracted is false in skill output.",
      );
    }
  }

  private split(
    output: AnalyzeDesignDraftOutput,
    designDocJsonPath: string | null,
  ): MergeDocumentResult {
    ensureNoesisLayout(this.projectDir);
    const docFile: DocumentFileNew = {
      document_id: output.document.id,
      title: output.document.title,
      date: output.document.date,
      content: output.document.content,
      fragments: output.fragments,
      section_tree: output.section_tree,
    };
    const docPath = this.canonicalPath(output.document.id);
    this.repository.writeFile(docPath, docFile);
    const documentSha = computeFileSha(docPath);

    const sourceShaCache = new Map<string, string>();
    sourceShaCache.set(`document:${output.document.id}`, documentSha);

    const parentLookup = new Map<string, string | null>();
    for (const pt of output.potential_topics.topics) {
      parentLookup.set(pt.id, pt.parent_id);
    }

    const topicPaths: string[] = [];
    for (const topic of output.topics) {
      topicPaths.push(
        this.writeTopicFile(
          topic,
          parentLookup.get(topic.id) ?? null,
          sourceShaCache,
        ),
      );
    }

    const decisionPaths: string[] = [];
    for (const topic of output.topics) {
      for (const decision of topic.decisions) {
        decisionPaths.push(
          this.writeDecisionFile(topic.id, decision, sourceShaCache),
        );
      }
    }

    const attached = this.applyDecisionAttachments(output, sourceShaCache);

    const finalDesignDocPath =
      designDocJsonPath === null
        ? null
        : this.designDocsService.persistFromWorkingFile(designDocJsonPath);

    return {
      document_id: output.document.id,
      topic_paths: topicPaths,
      decision_paths: decisionPaths,
      decision_attachments: attached,
      design_doc_path: finalDesignDocPath,
    };
  }

  private writeTopicFile(
    topic: AnalyzeDesignDraftOutput["topics"][number],
    parentId: string | null,
    cache: Map<string, string>,
  ): string {
    const path = topicJsonPath(this.projectDir, topic.id);
    const items = withItemShas(topic.items as TopicItemRefNew[], this.projectDir, cache);
    const existing = readTopicIfExists(path);
    const next: TopicFileNew = {
      id: topic.id,
      parent_id: parentId,
      title: topic.title,
      title_locked: existing?.title_locked ?? false,
      short_summary: topic.short_summary,
      short_summary_locked: existing?.short_summary_locked ?? false,
      long_summary: topic.long_summary,
      long_summary_locked: existing?.long_summary_locked ?? false,
      items: existing === null ? items : mergeItems(existing.items, items),
      reviewed: topic.reviewed,
      decisions_extracted: topic.decisions_extracted,
      is_stale: existing?.is_stale ?? false,
    };
    this.topicsRepository.writeFile(path, mergeLockedTopicFields(existing, next));
    return path;
  }

  private writeDecisionFile(
    topicId: string,
    decision: AnalyzeDesignDraftOutput["topics"][number]["decisions"][number],
    cache: Map<string, string>,
  ): string {
    const path = decisionJsonPath(this.projectDir, decision.id);
    const referenced = withItemShas(
      decision.referenced_items as TopicItemRefNew[],
      this.projectDir,
      cache,
    );
    const existing = readDecisionIfExists(path);
    const next: DecisionFileNew = {
      id: decision.id,
      topic_id: topicId,
      title: decision.title,
      title_locked: existing?.title_locked ?? false,
      status: decision.status,
      status_locked: existing?.status_locked ?? false,
      referenced_items: referenced,
      context: {
        text: decision.context.text,
        text_locked: existing?.context.text_locked ?? false,
        supporting_item_indices: decision.context.supporting_item_indices,
      },
      decision: {
        text: decision.decision.text,
        text_locked: existing?.decision.text_locked ?? false,
        rationale: decision.decision.rationale,
        rationale_locked: existing?.decision.rationale_locked ?? false,
        supporting_item_indices: decision.decision.supporting_item_indices,
      },
      alternative_options: decision.alternative_options.map((alt, i) => ({
        text: alt.text,
        text_locked: existing?.alternative_options[i]?.text_locked ?? false,
        rationale: alt.rationale,
        rationale_locked: existing?.alternative_options[i]?.rationale_locked ?? false,
        supporting_item_indices: alt.supporting_item_indices,
      })),
      is_stale: existing?.is_stale ?? false,
    };
    this.decisionsRepository.writeFile(path, applyDecisionLocks(existing, next));
    return path;
  }

  private applyDecisionAttachments(
    output: AnalyzeDesignDraftOutput,
    cache: Map<string, string>,
  ): number {
    if (output.decision_attachments.length === 0) return 0;
    const fragmentByIndex = new Map<number, AnalyzeDesignDraftOutput["fragments"][number]>();
    for (const f of output.fragments) fragmentByIndex.set(f.index, f);
    const documentSha = cache.get(`document:${output.document.id}`);
    const grouped = new Map<string, TopicItemRefNew[]>();
    for (const att of output.decision_attachments) {
      const refs: TopicItemRefNew[] = att.fragment_indices.map((fi) => {
        const f = fragmentByIndex.get(fi);
        if (f === undefined) {
          throw new Error(
            `decision_attachments references unknown fragment index ${fi}`,
          );
        }
        return {
          type: "document_fragment_ref",
          document_id: output.document.id,
          start_offset: f.start_offset,
          end_offset: f.end_offset,
          source_sha: documentSha,
        };
      });
      const list = grouped.get(att.decision_id) ?? [];
      list.push(...refs);
      grouped.set(att.decision_id, list);
    }
    let appended = 0;
    for (const [decisionId, refs] of grouped) {
      const path = decisionJsonPath(this.projectDir, decisionId);
      if (!this.decisionsRepository.fileExists(path)) {
        throw new Error(
          `decision_attachments target ${decisionId} has no source file at ${path}`,
        );
      }
      const file = this.decisionsRepository.readFile(path);
      const seen = new Set(file.referenced_items.map(itemKey));
      const additions: TopicItemRefNew[] = [];
      for (const ref of refs) {
        const k = itemKey(ref);
        if (seen.has(k)) continue;
        seen.add(k);
        additions.push(ref);
      }
      if (additions.length === 0) continue;
      const updated: DecisionFileNew = {
        ...file,
        referenced_items: [...file.referenced_items, ...additions],
      };
      this.decisionsRepository.writeFile(path, updated);
      appended += additions.length;
    }
    return appended;
  }

  private canonicalPath(documentId: string): string {
    return this.repository.canonicalPath(this.projectDir, documentId);
  }
}

function withItemShas(
  items: ReadonlyArray<TopicItemRefNew>,
  projectDir: string,
  cache: Map<string, string>,
): TopicItemRefNew[] {
  return items.map((item) => {
    const key =
      item.type === "idea_unit_ref"
        ? `conversation:${item.conversation_id}`
        : `document:${item.document_id}`;
    let sha = cache.get(key);
    if (sha === undefined) {
      const path =
        item.type === "idea_unit_ref"
          ? conversationJsonPath(projectDir, item.conversation_id)
          : documentJsonPath(projectDir, item.document_id);
      if (existsSync(path)) {
        sha = computeContentSha(readFileSync(path));
        cache.set(key, sha);
      }
    }
    return { ...item, source_sha: sha ?? item.source_sha };
  });
}

function mergeItems(prev: TopicItemRefNew[], next: TopicItemRefNew[]): TopicItemRefNew[] {
  const seen = new Set<string>();
  const out: TopicItemRefNew[] = [];
  for (const list of [prev, next]) {
    for (const item of list) {
      const key = itemKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

function itemKey(item: TopicItemRefNew): string {
  if (item.type === "idea_unit_ref") {
    return `iu:${item.conversation_id}:${item.turn_index}:${item.idea_unit_index}`;
  }
  return `doc:${item.document_id}:${item.start_offset}:${item.end_offset}`;
}

function readTopicIfExists(absPath: string): TopicFileNew | null {
  if (!existsSync(absPath)) return null;
  try {
    return TopicFileNewSchema.parse(JSON.parse(readFileSync(absPath, "utf-8")));
  } catch {
    return null;
  }
}

function readDecisionIfExists(absPath: string): DecisionFileNew | null {
  if (!existsSync(absPath)) return null;
  try {
    return DecisionFileNewSchema.parse(JSON.parse(readFileSync(absPath, "utf-8")));
  } catch {
    return null;
  }
}

function mergeLockedTopicFields(
  existing: TopicFileNew | null,
  next: TopicFileNew,
): TopicFileNew {
  if (existing === null) return next;
  return {
    ...next,
    title: existing.title_locked ? existing.title : next.title,
    short_summary: existing.short_summary_locked
      ? existing.short_summary
      : next.short_summary,
    long_summary: existing.long_summary_locked
      ? existing.long_summary
      : next.long_summary,
  };
}

function applyDecisionLocks(
  existing: DecisionFileNew | null,
  next: DecisionFileNew,
): DecisionFileNew {
  if (existing === null) return next;
  return {
    ...next,
    title: existing.title_locked ? existing.title : next.title,
    status: existing.status_locked ? existing.status : next.status,
    context: {
      ...next.context,
      text: existing.context.text_locked
        ? existing.context.text
        : next.context.text,
    },
    decision: {
      ...next.decision,
      text: existing.decision.text_locked
        ? existing.decision.text
        : next.decision.text,
      rationale: existing.decision.rationale_locked
        ? existing.decision.rationale
        : next.decision.rationale,
    },
    alternative_options: next.alternative_options.map((alt, i) => {
      const prev = existing.alternative_options[i];
      if (prev === undefined) return alt;
      return {
        ...alt,
        text: prev.text_locked ? prev.text : alt.text,
        rationale: prev.rationale_locked ? prev.rationale : alt.rationale,
      };
    }),
  };
}

function inferDocumentIdFromPath(absPath: string): string | null {
  const match = /\/documents\/([^/]+)\.json$/.exec(absPath);
  return match === null ? null : match[1];
}

void DesignDocFileNewSchema; // ensure schema export used via design-docs service
