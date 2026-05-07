import { Inject, Injectable, Logger } from "@nestjs/common";
import { readFile } from "fs/promises";
import { join } from "path";
import {
  AnalyzeDesignDraftOutputSchema,
  buildFragmentMap,
  formatEnrichedDocumentTopicMarkdown,
  resolveFragmentDetail,
  type AnalyzeDesignDraftOutput,
  type AttachToDecision,
  type EnrichedDocumentTopic,
  type FragmentDetail,
} from "../../../../shared-contracts/skills/analyze-design-draft/output.js";
import {
  DocumentSchema,
  isIrrelevantFragment,
  type Document,
} from "../../../../shared-contracts/documents.js";
import { type TopicItem } from "../../../../shared-contracts/topics.js";
import { assertNever } from "../../../../shared-contracts/assert-never.js";
import { documentMdPath } from "../../../../shared-contracts/source-files.js";
import type {
  DocumentDetailData,
  DocumentsPageData,
} from "../../ui-contracts/documents/documents-data.js";
import { PROJECT_DIR } from "../../config/config.module.js";
import { splitDocument } from "../../file-sync/document-splitter.js";
import { FileSyncService } from "../../file-sync/file-sync.service.js";
import {
  DecisionsService,
  type DecisionSupportSlot,
} from "../decisions/decisions.service.js";
import { TopicsRepository } from "../topics/topics.repository.js";
import { DocumentsRepository } from "./documents.repository.js";

export interface MergeDocumentResult {
  document_id: string;
  topics_added: number;
  topics_updated: number;
  decisions_added: number;
  decision_attachments: number;
  files_written: number;
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
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly repository: DocumentsRepository,
    private readonly topics: TopicsRepository,
    private readonly decisions: DecisionsService,
    private readonly fileSync: FileSyncService,
    @Inject(PROJECT_DIR) private readonly projectDir: string,
  ) {}

  async addDocumentFromFile(path: string): Promise<{ id: string }> {
    const document = await this.readDocumentFile(path);
    await this.repository.insertDocument(document);
    this.logger.log(`Added document ${document.id}`);
    return { id: document.id };
  }

  async getAllUnreviewedTopicsForDocument(
    outputPath: string,
  ): Promise<TopicForDocumentReview[]> {
    const output = await this.readOutputFile(outputPath);
    const reviews: TopicForDocumentReview[] = [];
    for (const topic of output.topics) {
      if (topic.reviewed) continue;
      const review = await this.buildTopicReview(output, topic);
      if (review !== null) reviews.push(review);
    }
    return reviews;
  }

  async getDocumentDetail(documentId: string): Promise<DocumentDetailData> {
    const head = await this.repository.readDocumentHead(documentId);
    if (head === null) throw new Error(`Document not found: ${documentId}`);
    const topics = await this.repository.listTopicsForDocument(documentId);
    const decisions = await this.repository.listDecisionsForDocument(documentId);
    return {
      id: head.document_id,
      title: head.title,
      date: head.date,
      topics,
      decisions,
    };
  }

  async getDocumentsPage(): Promise<DocumentsPageData> {
    const all = await this.repository.listAllDocuments();
    return {
      documents: all.map((d) => ({
        id: d.document_id,
        title: d.title,
        date: d.date,
      })),
    };
  }

  async getTopicForDocumentReview(
    outputPath: string,
  ): Promise<TopicForDocumentReview | null> {
    const output = await this.readOutputFile(outputPath);
    const topic = output.topics.find((t) => !t.reviewed) ?? null;
    if (topic === null) return null;
    return this.buildTopicReview(output, topic);
  }

  private async buildTopicReview(
    output: AnalyzeDesignDraftOutput,
    topic: AnalyzeDesignDraftOutput["topics"][number],
  ): Promise<TopicForDocumentReview> {
    const fragmentMap = buildFragmentMap(output.fragments);
    const priorFragments = await this.repository.getPriorDocumentFragments(
      topic.id,
      output.document.id,
    );

    const details: FragmentDetail[] = [];
    const seen = new Set<string>();

    for (const item of topic.items) {
      switch (item.type) {
        case "document_fragment_ref": {
          if (item.document_id !== output.document.id) break;
          const fragmentIndex = findFragmentByOffsets(
            output.fragments,
            item.start_offset,
            item.end_offset,
          );
          if (fragmentIndex === null) break;
          const detail = resolveFragmentDetail(
            output.document.id,
            fragmentIndex,
            fragmentMap,
          );
          if (detail === null || isIrrelevantFragment(detail.categories)) break;
          const key = fragmentKey(
            detail.document_id,
            detail.start_offset,
            detail.end_offset,
          );
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
      const key = fragmentKey(prior.document_id, prior.start_offset, prior.end_offset);
      if (seen.has(key)) continue;
      seen.add(key);
      details.push({
        document_id: prior.document_id,
        fragment_index: -1,
        start_offset: prior.start_offset,
        end_offset: prior.end_offset,
        section_path: prior.section_path,
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

  async hasDocument(documentId: string): Promise<boolean> {
    return this.repository.exists(documentId);
  }

  async mergeDocument(workingDir: string): Promise<MergeDocumentResult> {
    const output = await this.readOutputFile(join(workingDir, "output.json"));
    const document = output.document;
    const parentMap = buildParentMap(output.potential_topics.topics);

    if (!(await this.repository.exists(document.id))) {
      await this.repository.insertDocument(document);
    }

    let topicsAdded = 0;
    let topicsUpdated = 0;
    for (const topic of output.topics) {
      const fields = {
        title: topic.title,
        short_summary: topic.short_summary,
        long_summary: topic.long_summary,
      };
      if (await this.topics.exists(topic.id)) {
        await this.topics.updateTopicFields(topic.id, fields);
        topicsUpdated++;
      } else {
        await this.topics.insertTopicNode({ id: topic.id, ...fields });
        topicsAdded++;
      }
    }

    for (const topic of output.topics) {
      if (!parentMap.has(topic.id)) continue;
      const parentId = parentMap.get(topic.id) ?? null;
      await this.topics.deleteParentEdge(topic.id);
      if (parentId !== null) {
        await this.topics.linkSubtopic(parentId, topic.id);
      }
    }

    for (const topic of output.topics) {
      for (const item of topic.items) {
        switch (item.type) {
          case "document_fragment_ref": {
            const fragId = await this.repository.ensureFragmentNode(
              item.document_id,
              item.start_offset,
              item.end_offset,
            );
            await this.topics.linkToDocumentFragment(topic.id, fragId);
            break;
          }
          case "idea_unit_ref":
            break;
          default:
            assertNever(item);
        }
      }
    }

    let decisionsAdded = 0;
    for (const topic of output.topics) {
      for (const decision of topic.decisions) {
        await this.decisions.addDecision(topic.id, decision);
        decisionsAdded++;
      }
    }

    let attachmentsApplied = 0;
    for (const attachment of output.decision_attachments) {
      const items = attachmentToItems(attachment, output);
      if (items.length === 0) continue;
      const slot = attachmentToSlot(attachment);
      await this.decisions.addItemsToDecisionSlot(
        attachment.decision_id,
        slot,
        items,
      );
      attachmentsApplied++;
    }

    const splitResult = splitDocument(output, {
      projectDir: this.projectDir,
      sourceMdPath: documentMdPath(this.projectDir, document.id),
    });
    const allPaths = [
      splitResult.md_path,
      splitResult.sidecar_path,
      ...splitResult.topic_paths,
      ...splitResult.decision_paths,
    ];
    for (const path of allPaths) {
      await this.fileSync.registerWritten(path);
    }
    await this.fileSync.refreshStaleFlags();
    const filesWritten =
      2 + splitResult.topic_paths.length + splitResult.decision_paths.length;

    this.logger.log(
      `Merged document ${document.id}: +${topicsAdded} topics, ~${topicsUpdated} updated, +${decisionsAdded} decisions, +${attachmentsApplied} attachments, ${filesWritten} files written under noesis/`,
    );

    return {
      document_id: document.id,
      topics_added: topicsAdded,
      topics_updated: topicsUpdated,
      decisions_added: decisionsAdded,
      decision_attachments: attachmentsApplied,
      files_written: filesWritten,
    };
  }

  private async readOutputFile(
    path: string,
  ): Promise<AnalyzeDesignDraftOutput> {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    return AnalyzeDesignDraftOutputSchema.parse(parsed);
  }

  private async readDocumentFile(path: string): Promise<Document> {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    return DocumentSchema.parse(parsed);
  }
}

function attachmentToItems(
  attachment: AttachToDecision,
  output: AnalyzeDesignDraftOutput,
): TopicItem[] {
  const fragmentMap = buildFragmentMap(output.fragments);
  const items: TopicItem[] = [];
  for (const fi of attachment.fragment_indices) {
    const fragment = fragmentMap.get(fi);
    if (fragment === undefined) continue;
    items.push({
      type: "document_fragment_ref",
      document_id: output.document.id,
      start_offset: fragment.start_offset,
      end_offset: fragment.end_offset,
    });
  }
  return items;
}

function attachmentToSlot(attachment: AttachToDecision): DecisionSupportSlot {
  switch (attachment.slot) {
    case "context":
    case "decision":
      return { slot: attachment.slot };
    case "alternative":
      if (attachment.alternative_index === null) {
        throw new Error(
          `Attachment to decision ${attachment.decision_id}: alternative_index is required when slot=alternative`,
        );
      }
      return {
        slot: "alternative",
        alternative_index: attachment.alternative_index,
      };
    default:
      return assertNever(attachment.slot);
  }
}

function findFragmentByOffsets(
  fragments: AnalyzeDesignDraftOutput["fragments"],
  startOffset: number,
  endOffset: number,
): number | null {
  for (const f of fragments) {
    if (f.start_offset === startOffset && f.end_offset === endOffset) {
      return f.index;
    }
  }
  return null;
}

function fragmentKey(documentId: string, start: number, end: number): string {
  return `${documentId}:${start}:${end}`;
}

function buildParentMap(
  potentialTopics: AnalyzeDesignDraftOutput["potential_topics"]["topics"],
): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const t of potentialTopics) {
    if (t.is_new) map.set(t.id, t.parent_id);
  }
  return map;
}
