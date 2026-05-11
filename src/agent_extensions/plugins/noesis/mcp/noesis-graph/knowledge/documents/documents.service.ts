import { Inject, Injectable } from "@nestjs/common";
import { existsSync, readFileSync } from "fs";
import { assertNever } from "../../../../shared-contracts/assert-never.js";
import { isIrrelevantFragment } from "../../../../shared-contracts/documents.js";
import {
  AnalyzeDesignDraftOutputSchema,
  buildFragmentMap,
  formatEnrichedDocumentTopicMarkdown,
  resolveFragmentDetail,
  type AnalyzeDesignDraftOutput,
  type EnrichedDocumentTopic,
  type FragmentDetail,
} from "../../../../shared-contracts/skills/analyze-design-draft/output.js";
import { type DesignDocFileNew } from "../../../../shared-contracts/design-doc-new.js";
import {
  DecisionFileNewSchema,
  TopicFileNewSchema,
  type DecisionFileNew,
  type DocumentFileNew,
  type TopicFileNew,
  type TopicItemRefNew,
} from "../../../../shared-contracts/source-file-schemas.js";
import {
  computeContentSha,
  computeFileSha,
  findConversationJsonById,
  findDocumentJsonById,
} from "../../../../shared-contracts/source-files.js";
import type {
  DocumentDecisionRef,
  DocumentDetailData,
  DocumentListItem,
  DocumentsPageData,
  DocumentTopicRef,
} from "../../ui-contracts/documents/documents-data.js";
import { PROJECT_DIR } from "../../config/config.module.js";
import { DecisionsRepository } from "../decisions/decisions.repository.js";
import { DesignDocsService } from "../design-docs/design-docs.service.js";
import {
  confirmedKey,
  detectDecisionConflicts,
  detectTopicConflicts,
  LockedFieldsBlockedError,
  resolveDecisionLockedFields,
  resolveTopicLockedFields,
  type ConfirmedEdit,
} from "../locks.js";
import { TopicsRepository } from "../topics/topics.repository.js";
import { DocumentsRepository } from "./documents.repository.js";

export {
  LockedFieldsBlockedError,
  type ConfirmedEdit,
  type DecisionLockedField,
  type DesignDocLockedField,
  type TopicLockedField,
} from "../locks.js";

export interface DocumentAnalysisInput {
  outputJsonPath: string;
  designDocJsonPath: string | null;
  confirmed_edits?: ConfirmedEdit[];
}

export interface UploadDocumentAnalysisResult {
  document_id: string;
  topic_paths: string[];
  decision_paths: string[];
  decision_attachments: number;
  design_doc_path: string | null;
  cleared_locks: ConfirmedEdit[];
}

export interface IndexFileOutcome {
  status: "indexed" | "unchanged";
  document_id: string;
}

export interface TopicForDocumentReview {
  topic_id: string;
  topic_title: string;
  num_items: number;
  has_decision_units: boolean;
  markdown: string;
}

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(PROJECT_DIR) private readonly projectDir: string,
    private readonly repository: DocumentsRepository,
    private readonly topicsRepository: TopicsRepository,
    private readonly decisionsRepository: DecisionsRepository,
    private readonly designDocsService: DesignDocsService,
  ) {}

  async deleteForFile(
    absPath: string,
  ): Promise<{ document_id: string } | null> {
    const stored = await this.findStoredForFile(absPath);
    if (stored === null) return null;
    await this.repository.delete(stored.id);
    const json = this.repository.findJsonById(this.projectDir, stored.id);
    if (json !== null) this.repository.deleteFile(json);
    return { document_id: stored.id };
  }

  private async findStoredForFile(
    absPath: string,
  ): Promise<{ id: string; title: string } | null> {
    const all = await this.repository.listAll();
    for (const d of all) {
      const json = this.repository.canonicalPath(this.projectDir, d.id, d.title);
      if (json === absPath) return d;
    }
    return null;
  }

  async getAllUnreviewedTopicsForDocument(
    outputPath: string,
  ): Promise<TopicForDocumentReview[]> {
    const output = await this.loadOutputAsync(outputPath);
    const reviews: TopicForDocumentReview[] = [];
    for (const topic of output.topics) {
      if (topic.reviewed) continue;
      reviews.push(await this.buildTopicReview(output, topic));
    }
    return reviews;
  }

  async getDocumentDetail(documentId: string): Promise<DocumentDetailData> {
    const head = await this.repository.read(documentId);
    if (head === null) {
      throw new Error(`Document not found: ${documentId}`);
    }
    const [topics, decisions] = await Promise.all([
      this.collectLinkedTopics(documentId),
      this.collectLinkedDecisions(documentId),
    ]);
    return {
      id: head.id,
      title: head.title,
      date: head.date,
      topics,
      decisions,
    };
  }

  async getDocumentsPage(): Promise<DocumentsPageData> {
    const all = await this.repository.listAll();
    const documents: DocumentListItem[] = all.map((d) => ({
      id: d.id,
      title: d.title,
      date: d.date,
    }));
    return { documents };
  }

  async getTopicForDocumentReview(
    outputPath: string,
  ): Promise<TopicForDocumentReview | null> {
    const output = await this.loadOutputAsync(outputPath);
    const topic = output.topics.find((t) => !t.reviewed) ?? null;
    if (topic === null) return null;
    return this.buildTopicReview(output, topic);
  }

  async hasDocument(documentId: string): Promise<boolean> {
    return this.repository.exists(documentId);
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

  async uploadAnalysis(
    input: DocumentAnalysisInput,
  ): Promise<UploadDocumentAnalysisResult> {
    const output = this.loadOutput(input.outputJsonPath);
    this.validate(output, input.designDocJsonPath !== null);
    const designDocFile =
      input.designDocJsonPath === null
        ? null
        : this.designDocsService.loadWorkingFile(input.designDocJsonPath);
    const conflicts = this.detectLockedFieldConflicts(output, designDocFile);
    if (input.confirmed_edits === undefined && conflicts.length > 0) {
      throw new LockedFieldsBlockedError(conflicts);
    }
    const confirmed = new Set(
      (input.confirmed_edits ?? []).map(confirmedKey),
    );
    return this.split(output, input.designDocJsonPath, confirmed);
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

  private detectLockedFieldConflicts(
    output: AnalyzeDesignDraftOutput,
    designDocFile: DesignDocFileNew | null,
  ): ConfirmedEdit[] {
    const conflicts: ConfirmedEdit[] = [];
    for (const topic of output.topics) {
      const topicPath = this.topicsRepository.findFileById(
        this.projectDir,
        topic.id,
      );
      const existingTopic =
        topicPath === null ? null : readTopicIfExists(topicPath);
      conflicts.push(...detectTopicConflicts(existingTopic, topic));
      for (const decision of topic.decisions) {
        const dpath = this.decisionsRepository.findFileById(
          this.projectDir,
          decision.id,
        );
        const existingDecision =
          dpath !== null && this.decisionsRepository.fileExists(dpath)
            ? this.decisionsRepository.readFile(dpath)
            : null;
        conflicts.push(...detectDecisionConflicts(existingDecision, decision));
      }
    }
    if (designDocFile !== null) {
      conflicts.push(...this.designDocsService.detectConflicts(designDocFile));
    }
    return conflicts;
  }

  private split(
    output: AnalyzeDesignDraftOutput,
    designDocJsonPath: string | null,
    confirmed: Set<string>,
  ): UploadDocumentAnalysisResult {
    const docFile: DocumentFileNew = {
      document_id: output.document.id,
      title: output.document.title,
      date: output.document.date,
      content: output.document.content,
      fragments: output.fragments,
      section_tree: output.section_tree,
    };
    const docPath = this.persistDocumentFile(docFile);
    const documentSha = computeFileSha(docPath);

    const sourceShaCache = new Map<string, string>();
    sourceShaCache.set(`document:${output.document.id}`, documentSha);

    const parentLookup = new Map<string, string | null>();
    for (const pt of output.potential_topics.topics) {
      parentLookup.set(pt.id, pt.parent_id);
    }

    const topicPaths: string[] = [];
    const decisionPaths: string[] = [];
    const clearedLocks: ConfirmedEdit[] = [];

    for (const topic of output.topics) {
      const tr = this.writeTopicFile(
        topic,
        parentLookup.get(topic.id) ?? null,
        sourceShaCache,
        confirmed,
      );
      topicPaths.push(tr.path);
      clearedLocks.push(...tr.cleared);
      for (const decision of topic.decisions) {
        const dr = this.writeDecisionFile(
          topic.id,
          decision,
          sourceShaCache,
          confirmed,
        );
        decisionPaths.push(dr.path);
        clearedLocks.push(...dr.cleared);
      }
    }

    const attached = this.applyDecisionAttachments(output, sourceShaCache);

    let designDocPath: string | null = null;
    if (designDocJsonPath !== null) {
      const dr = this.designDocsService.persistFromWorkingFile(
        designDocJsonPath,
        confirmed,
      );
      designDocPath = dr.path;
      clearedLocks.push(...dr.cleared);
    }

    return {
      document_id: output.document.id,
      topic_paths: topicPaths,
      decision_paths: decisionPaths,
      decision_attachments: attached,
      design_doc_path: designDocPath,
      cleared_locks: clearedLocks,
    };
  }

  private writeTopicFile(
    topic: AnalyzeDesignDraftOutput["topics"][number],
    parentId: string | null,
    cache: Map<string, string>,
    confirmed: Set<string>,
  ): { path: string; cleared: ConfirmedEdit[] } {
    const items = withItemShas(topic.items as TopicItemRefNew[], this.projectDir, cache);
    const existingPath = this.topicsRepository.findFileById(
      this.projectDir,
      topic.id,
    );
    const existing =
      existingPath === null ? null : readTopicIfExists(existingPath);
    const cleared: ConfirmedEdit[] = [];
    const resolved = resolveTopicLockedFields(existing, topic, confirmed, cleared);
    const next: TopicFileNew = {
      id: topic.id,
      parent_id: parentId,
      title: resolved.title,
      title_locked: resolved.title_locked,
      short_summary: resolved.short_summary,
      short_summary_locked: resolved.short_summary_locked,
      long_summary: resolved.long_summary,
      long_summary_locked: resolved.long_summary_locked,
      items: existing === null ? items : mergeItems(existing.items, items),
      reviewed: topic.reviewed,
      decisions_extracted: topic.decisions_extracted,
      is_stale: existing?.is_stale ?? false,
    };
    const newPath = this.topicsRepository.canonicalPath(
      this.projectDir,
      next.id,
      next.title,
    );
    if (existingPath !== null && existingPath !== newPath) {
      this.topicsRepository.deleteFile(existingPath);
    }
    this.topicsRepository.writeFile(newPath, next);
    return { path: newPath, cleared };
  }

  private writeDecisionFile(
    topicId: string,
    decision: AnalyzeDesignDraftOutput["topics"][number]["decisions"][number],
    cache: Map<string, string>,
    confirmed: Set<string>,
  ): { path: string; cleared: ConfirmedEdit[] } {
    const existingPath = this.decisionsRepository.findFileById(
      this.projectDir,
      decision.id,
    );
    const referenced = withItemShas(
      decision.referenced_items as TopicItemRefNew[],
      this.projectDir,
      cache,
    );
    const existing =
      existingPath === null ? null : readDecisionIfExists(existingPath);
    const cleared: ConfirmedEdit[] = [];
    const resolved = resolveDecisionLockedFields(
      existing,
      decision,
      confirmed,
      cleared,
    );
    const next: DecisionFileNew = {
      id: decision.id,
      topic_id: topicId,
      title: resolved.title,
      title_locked: resolved.title_locked,
      status: resolved.status,
      status_locked: resolved.status_locked,
      referenced_items: referenced,
      context: {
        text: resolved.context_text,
        text_locked: resolved.context_text_locked,
        supporting_item_indices: decision.context.supporting_item_indices,
      },
      decision: {
        text: resolved.decision_text,
        text_locked: resolved.decision_text_locked,
        rationale: resolved.decision_rationale,
        rationale_locked: resolved.decision_rationale_locked,
        supporting_item_indices: decision.decision.supporting_item_indices,
      },
      alternative_options: decision.alternative_options.map((alt, i) => ({
        text: alt.text,
        text_locked: existing?.alternative_options[i]?.text_locked ?? false,
        rationale: alt.rationale,
        rationale_locked:
          existing?.alternative_options[i]?.rationale_locked ?? false,
        supporting_item_indices: alt.supporting_item_indices,
      })),
      is_stale: existing?.is_stale ?? false,
    };
    const newPath = this.decisionsRepository.canonicalPath(
      this.projectDir,
      next.id,
      next.title,
    );
    if (existingPath !== null && existingPath !== newPath) {
      this.decisionsRepository.deleteFile(existingPath);
    }
    this.decisionsRepository.writeFile(newPath, next);
    return { path: newPath, cleared };
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
      const path = this.decisionsRepository.findFileById(this.projectDir, decisionId);
      if (path === null) {
        throw new Error(
          `decision_attachments target ${decisionId} has no source file on disk`,
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

  private persistDocumentFile(file: DocumentFileNew): string {
    const newPath = this.repository.canonicalPath(
      this.projectDir,
      file.document_id,
      file.title,
    );
    const previous = this.repository.findJsonById(
      this.projectDir,
      file.document_id,
    );
    if (previous !== null && previous !== newPath) {
      this.repository.deleteFile(previous);
    }
    this.repository.writeFile(newPath, file);
    return newPath;
  }

  private async buildTopicReview(
    output: AnalyzeDesignDraftOutput,
    topic: AnalyzeDesignDraftOutput["topics"][number],
  ): Promise<TopicForDocumentReview> {
    const fragmentMap = buildFragmentMap(output.fragments);
    const priorFragments = await this.findPriorDocumentFragments(
      topic.id,
      output.document.id,
    );

    const details: FragmentDetail[] = [];
    const seen = new Set<string>();
    for (const item of topic.items) {
      switch (item.type) {
        case "document_fragment_ref": {
          if (item.document_id !== output.document.id) break;
          const fragment = output.fragments.find(
            (f) =>
              f.start_offset === item.start_offset &&
              f.end_offset === item.end_offset,
          );
          if (fragment === undefined) break;
          const detail = resolveFragmentDetail(
            output.document.id,
            fragment.index,
            fragmentMap,
          );
          if (detail === null || isIrrelevantFragment(detail.categories)) break;
          const key = fragmentKey(detail.document_id, detail.start_offset, detail.end_offset);
          if (seen.has(key)) break;
          seen.add(key);
          details.push(detail);
          break;
        }
        case "idea_unit_ref":
          break;
        default:
          assertNever(item);
      }
    }
    for (const prior of priorFragments) {
      const key = fragmentKey(
        prior.document_id,
        prior.start_offset,
        prior.end_offset,
      );
      if (seen.has(key)) continue;
      seen.add(key);
      details.push({
        document_id: prior.document_id,
        fragment_index: -1,
        start_offset: prior.start_offset,
        end_offset: prior.end_offset,
        section_path: [],
        kind: "paragraph",
        text: `[from ${prior.document_title}] ${prior.text}`,
        categories: [],
      });
    }

    const enriched: EnrichedDocumentTopic = {
      id: topic.id,
      title: topic.title,
      short_summary: topic.short_summary,
      long_summary: topic.long_summary,
      document_id: output.document.id,
      fragments: details,
    };

    return {
      topic_id: topic.id,
      topic_title: topic.title,
      num_items: details.length,
      has_decision_units: details.some((d) => d.categories.includes("Decision")),
      markdown: formatEnrichedDocumentTopicMarkdown(enriched),
    };
  }

  private async collectLinkedDecisions(
    documentId: string,
  ): Promise<DocumentDecisionRef[]> {
    const stored = await this.decisionsRepository.listAll();
    const out: DocumentDecisionRef[] = [];
    for (const decision of stored) {
      const path = this.decisionsRepository.findFileById(
        this.projectDir,
        decision.id,
      );
      if (path === null) continue;
      const file = this.decisionsRepository.readFile(path);
      if (!fileReferencesDocument(file.referenced_items, documentId)) continue;
      out.push({
        decision_id: decision.id,
        title: decision.title,
        status: decision.status,
      });
    }
    out.sort((a, b) => a.title.localeCompare(b.title));
    return out;
  }

  private async collectLinkedTopics(
    documentId: string,
  ): Promise<DocumentTopicRef[]> {
    const stored = await this.topicsRepository.listAll();
    const out: DocumentTopicRef[] = [];
    for (const topic of stored) {
      const path = this.topicsRepository.findFileById(this.projectDir, topic.id);
      if (path === null) continue;
      const file = this.topicsRepository.readFile(path);
      if (!fileReferencesDocument(file.items, documentId)) continue;
      out.push({ topic_id: topic.id, title: topic.title });
    }
    out.sort((a, b) => a.title.localeCompare(b.title));
    return out;
  }

  private async findPriorDocumentFragments(
    topicId: string,
    excludeDocumentId: string,
  ): Promise<
    Array<{
      document_id: string;
      document_title: string;
      start_offset: number;
      end_offset: number;
      text: string;
    }>
  > {
    const path = this.topicsRepository.findFileById(this.projectDir, topicId);
    if (path === null) return [];
    const file = this.topicsRepository.readFile(path);
    const rangesByDocument = new Map<
      string,
      Array<{ start: number; end: number }>
    >();
    for (const item of file.items) {
      if (item.type !== "document_fragment_ref") continue;
      if (item.document_id === excludeDocumentId) continue;
      const list = rangesByDocument.get(item.document_id) ?? [];
      list.push({ start: item.start_offset, end: item.end_offset });
      rangesByDocument.set(item.document_id, list);
    }
    if (rangesByDocument.size === 0) return [];
    const heads = await this.repository.listByIds([...rangesByDocument.keys()]);
    const out: Array<{
      document_id: string;
      document_title: string;
      start_offset: number;
      end_offset: number;
      text: string;
    }> = [];
    for (const head of heads) {
      const content = (await this.repository.readContent(head.id)) ?? "";
      const ranges = rangesByDocument.get(head.id) ?? [];
      for (const { start, end } of ranges) {
        out.push({
          document_id: head.id,
          document_title: head.title,
          start_offset: start,
          end_offset: end,
          text: content.slice(start, end).trim(),
        });
      }
    }
    out.sort((a, b) => {
      if (a.document_id !== b.document_id)
        return a.document_id.localeCompare(b.document_id);
      return a.start_offset - b.start_offset;
    });
    return out;
  }

  private async loadOutputAsync(
    outputPath: string,
  ): Promise<AnalyzeDesignDraftOutput> {
    return this.loadOutput(outputPath);
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
          ? findConversationJsonById(projectDir, item.conversation_id)
          : findDocumentJsonById(projectDir, item.document_id);
      if (path !== null && existsSync(path)) {
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

function fileReferencesDocument(
  items: TopicItemRefNew[],
  documentId: string,
): boolean {
  for (const item of items) {
    if (
      item.type === "document_fragment_ref" &&
      item.document_id === documentId
    ) {
      return true;
    }
  }
  return false;
}

function fragmentKey(documentId: string, start: number, end: number): string {
  return `${documentId}:${start}:${end}`;
}
