import { Inject, Injectable } from "@nestjs/common";
import { existsSync, readFileSync, rmSync } from "fs";
import {
  AnalyzeConversationOutputSchema,
  type AnalyzeConversationOutput,
} from "../../../../shared-contracts/skills/analyze-conversation/output.js";
import {
  TopicFileNewSchema,
  type ConversationFileNew,
  type DecisionFileNew,
  type TopicFileNew,
  type TopicItemRefNew,
} from "../../../../shared-contracts/source-file-schemas-new.js";
import {
  computeContentSha,
  computeFileSha,
  conversationJsonPath,
  conversationMdPath,
  decisionJsonPath,
  documentJsonPath,
  ensureNoesisLayout,
  stampIdLine,
  topicJsonPath,
} from "../../../../shared-contracts/source-files.js";
import { PROJECT_DIR } from "../../config/config.module.js";
import { DecisionsRepositoryNew } from "../decisions/decisions-new.repository.js";
import { TopicsRepositoryNew } from "../topics/topics-new.repository.js";
import { ConversationsRepositoryNew } from "./conversations-new.repository.js";

export type TopicLockedField = "title" | "short_summary" | "long_summary";

export type DecisionLockedField =
  | "title"
  | "status"
  | "context.text"
  | "decision.text"
  | "decision.rationale";

export type ConfirmedEdit =
  | { kind: "topic"; topic_id: string; field: TopicLockedField }
  | { kind: "decision"; decision_id: string; field: DecisionLockedField };

export interface ConversationAnalysisOutput {
  outputJsonPath: string;
  cleanedMdPath: string;
  confirmed_edits?: ConfirmedEdit[];
}

export interface UploadConversationAnalysisResult {
  conversation_id: string;
  topic_paths: string[];
  decision_paths: string[];
  cleared_locks: ConfirmedEdit[];
}

export interface IndexFileOutcome {
  status: "indexed" | "unchanged";
  conversation_id: string;
}

export class LockedFieldsBlockedError extends Error {
  readonly blocked: ConfirmedEdit[];
  constructor(blocked: ConfirmedEdit[]) {
    super(
      `Upload would overwrite ${blocked.length} locked field(s) without user confirmation: ` +
        blocked.map(formatConfirmedEdit).join(", "),
    );
    this.name = "LockedFieldsBlockedError";
    this.blocked = blocked;
  }
}

function formatConfirmedEdit(edit: ConfirmedEdit): string {
  return edit.kind === "topic"
    ? `topic:${edit.topic_id}.${edit.field}`
    : `decision:${edit.decision_id}.${edit.field}`;
}

function confirmedKey(edit: ConfirmedEdit): string {
  return formatConfirmedEdit(edit);
}

@Injectable()
export class ConversationsServiceNew {
  constructor(
    @Inject(PROJECT_DIR) private readonly projectDir: string,
    private readonly repository: ConversationsRepositoryNew,
    private readonly topicsRepository: TopicsRepositoryNew,
    private readonly decisionsRepository: DecisionsRepositoryNew,
  ) {}

  async deleteForFile(
    absPath: string,
  ): Promise<{ conversation_id: string } | null> {
    const id = inferConversationIdFromPath(absPath);
    if (id === null) return null;
    if (!(await this.repository.exists(id))) return null;
    await this.repository.delete(id);
    rmSync(conversationJsonPath(this.projectDir, id), { force: true });
    rmSync(conversationMdPath(this.projectDir, id), { force: true });
    return { conversation_id: id };
  }

  async indexFile(absPath: string): Promise<IndexFileOutcome> {
    const sha = this.repository.fileSha(absPath);
    const file = this.repository.readJsonFile(absPath);
    const stored = await this.repository.read(file.conversation_id);
    if (stored !== null && stored.sha === sha) {
      return { status: "unchanged", conversation_id: file.conversation_id };
    }
    await this.repository.upsert(file, sha);
    return { status: "indexed", conversation_id: file.conversation_id };
  }

  async listAllStoredFiles(): Promise<
    Array<{ id: string; path: string; sha: string }>
  > {
    return this.repository.listAllStoredFiles(this.projectDir);
  }

  async uploadAnalysis(input: ConversationAnalysisOutput): Promise<UploadConversationAnalysisResult> {
    const output = this.loadOutput(input.outputJsonPath);
    this.validate(output);
    const conflicts = this.detectLockedFieldConflicts(output);
    if (input.confirmed_edits === undefined && conflicts.length > 0) {
      throw new LockedFieldsBlockedError(conflicts);
    }
    const confirmedSet = new Set((input.confirmed_edits ?? []).map(confirmedKey));
    const cleanedMd = this.loadCleanedMd(input.cleanedMdPath);
    return this.split(output, cleanedMd, confirmedSet);
  }

  // ----- private: merge pipeline -----

  private loadOutput(path: string): AnalyzeConversationOutput {
    if (!existsSync(path)) {
      throw new Error(`analyze-conversation output not found at ${path}`);
    }
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    return AnalyzeConversationOutputSchema.parse(parsed);
  }

  private loadCleanedMd(path: string): string {
    if (!existsSync(path)) {
      throw new Error(`Cleaned conversation md not found at ${path}`);
    }
    return readFileSync(path, "utf-8");
  }

  private validate(output: AnalyzeConversationOutput): void {
    const conv = output.conversation;
    const refMap = new Map<string, true>();
    for (const turn of conv.turns) {
      for (const iu of turn.idea_units) {
        refMap.set(`${turn.index}|${iu.index}`, true);
      }
    }
    for (const topic of conv.topics) {
      if (!topic.reviewed) {
        throw new Error(
          `Topic ${topic.id} is not marked reviewed; analyze-conversation must complete the review pass.`,
        );
      }
      for (const item of topic.items) {
        if (item.type !== "idea_unit_ref") continue;
        if (item.conversation_id !== conv.conversation_id) continue;
        const key = `${item.turn_index}|${item.idea_unit_index}`;
        if (!refMap.has(key)) {
          throw new Error(
            `Topic ${topic.id} references unknown idea unit ${key} in current conversation.`,
          );
        }
      }
    }
    const topicIds = new Set(conv.topics.map((t) => t.id));
    for (const pt of output.potential_topics.topics) {
      if (pt.parent_id !== null && pt.is_new && !topicIds.has(pt.id)) {
        throw new Error(
          `potential_topics references new topic ${pt.id} not present in conversation.topics`,
        );
      }
    }
  }

  private detectLockedFieldConflicts(
    output: AnalyzeConversationOutput,
  ): ConfirmedEdit[] {
    const conflicts: ConfirmedEdit[] = [];
    for (const topic of output.conversation.topics) {
      const existing = readTopicIfExists(topicJsonPath(this.projectDir, topic.id));
      if (existing !== null) {
        if (existing.title_locked && existing.title !== topic.title) {
          conflicts.push({ kind: "topic", topic_id: topic.id, field: "title" });
        }
        if (
          existing.short_summary_locked &&
          existing.short_summary !== topic.short_summary
        ) {
          conflicts.push({
            kind: "topic",
            topic_id: topic.id,
            field: "short_summary",
          });
        }
        if (
          existing.long_summary_locked &&
          existing.long_summary !== topic.long_summary
        ) {
          conflicts.push({
            kind: "topic",
            topic_id: topic.id,
            field: "long_summary",
          });
        }
      }
      for (const decision of topic.decisions) {
        const dpath = decisionJsonPath(this.projectDir, decision.id);
        if (!this.decisionsRepository.fileExists(dpath)) continue;
        const dexisting = this.decisionsRepository.readFile(dpath);
        if (dexisting.title_locked && dexisting.title !== decision.title) {
          conflicts.push({
            kind: "decision",
            decision_id: decision.id,
            field: "title",
          });
        }
        if (dexisting.status_locked && dexisting.status !== decision.status) {
          conflicts.push({
            kind: "decision",
            decision_id: decision.id,
            field: "status",
          });
        }
        if (
          dexisting.context.text_locked &&
          dexisting.context.text !== decision.context.text
        ) {
          conflicts.push({
            kind: "decision",
            decision_id: decision.id,
            field: "context.text",
          });
        }
        if (
          dexisting.decision.text_locked &&
          dexisting.decision.text !== decision.decision.text
        ) {
          conflicts.push({
            kind: "decision",
            decision_id: decision.id,
            field: "decision.text",
          });
        }
        if (
          dexisting.decision.rationale_locked &&
          dexisting.decision.rationale !== decision.decision.rationale
        ) {
          conflicts.push({
            kind: "decision",
            decision_id: decision.id,
            field: "decision.rationale",
          });
        }
      }
    }
    return conflicts;
  }

  private split(
    output: AnalyzeConversationOutput,
    cleanedMd: string,
    confirmed: Set<string>,
  ): UploadConversationAnalysisResult {
    ensureNoesisLayout(this.projectDir);
    const conv = output.conversation;
    const stampedMd = stampIdLine(cleanedMd, "conversation", conv.conversation_id);
    const mdPath = this.canonicalMdPath(conv.conversation_id);
    this.repository.writeCleanedMd(mdPath, stampedMd);

    const conversationFile: ConversationFileNew = {
      conversation_id: conv.conversation_id,
      time: conv.time,
      main_topic: conv.main_topic,
      turns: conv.turns,
    };
    const jsonPath = this.canonicalJsonPath(conv.conversation_id);
    this.repository.writeJsonFile(jsonPath, conversationFile);

    const conversationSha = computeFileSha(jsonPath);
    const parentLookup = new Map<string, string | null>();
    for (const pt of output.potential_topics.topics) {
      parentLookup.set(pt.id, pt.parent_id);
    }

    const sourceShaCache = new Map<string, string>();
    sourceShaCache.set(`conversation:${conv.conversation_id}`, conversationSha);

    const topicPaths: string[] = [];
    const decisionPaths: string[] = [];
    const clearedLocks: ConfirmedEdit[] = [];

    for (const topic of conv.topics) {
      const { path, cleared } = this.writeTopicFile(
        topic,
        parentLookup.get(topic.id) ?? null,
        sourceShaCache,
        confirmed,
      );
      topicPaths.push(path);
      clearedLocks.push(...cleared);
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

    return {
      conversation_id: conv.conversation_id,
      topic_paths: topicPaths,
      decision_paths: decisionPaths,
      cleared_locks: clearedLocks,
    };
  }

  private writeTopicFile(
    topic: AnalyzeConversationOutput["conversation"]["topics"][number],
    parentId: string | null,
    cache: Map<string, string>,
    confirmed: Set<string>,
  ): { path: string; cleared: ConfirmedEdit[] } {
    const path = topicJsonPath(this.projectDir, topic.id);
    const items = withItemShas(topic.items as TopicItemRefNew[], this.projectDir, cache);
    const existing = readTopicIfExists(path);
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
    this.topicsRepository.writeFile(path, next);
    return { path, cleared };
  }

  private writeDecisionFile(
    topicId: string,
    decision: AnalyzeConversationOutput["conversation"]["topics"][number]["decisions"][number],
    cache: Map<string, string>,
    confirmed: Set<string>,
  ): { path: string; cleared: ConfirmedEdit[] } {
    const path = decisionJsonPath(this.projectDir, decision.id);
    const referenced = withItemShas(
      decision.referenced_items as TopicItemRefNew[],
      this.projectDir,
      cache,
    );
    const existing = this.decisionsRepository.fileExists(path)
      ? this.decisionsRepository.readFile(path)
      : null;
    const cleared: ConfirmedEdit[] = [];
    const resolved = resolveDecisionLockedFields(existing, decision, confirmed, cleared);
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
        rationale_locked: existing?.alternative_options[i]?.rationale_locked ?? false,
        supporting_item_indices: alt.supporting_item_indices,
      })),
      is_stale: existing?.is_stale ?? false,
    };
    this.decisionsRepository.writeFile(path, next);
    return { path, cleared };
  }

  private canonicalJsonPath(conversationId: string): string {
    return this.repository.canonicalJsonPath(this.projectDir, conversationId);
  }

  private canonicalMdPath(conversationId: string): string {
    return this.repository.canonicalMdPath(this.projectDir, conversationId);
  }
}

function withItemShas(
  items: ReadonlyArray<TopicItemRefNew>,
  projectDir: string,
  cache: Map<string, string>,
): TopicItemRefNew[] {
  return items.map((item) => {
    const sha = resolveSourceSha(item, projectDir, cache);
    return { ...item, source_sha: sha ?? item.source_sha };
  });
}

function resolveSourceSha(
  item: TopicItemRefNew,
  projectDir: string,
  cache: Map<string, string>,
): string | undefined {
  const key =
    item.type === "idea_unit_ref"
      ? `conversation:${item.conversation_id}`
      : `document:${item.document_id}`;
  if (cache.has(key)) return cache.get(key);
  const path =
    item.type === "idea_unit_ref"
      ? conversationJsonPath(projectDir, item.conversation_id)
      : documentJsonPath(projectDir, item.document_id);
  if (!existsSync(path)) return undefined;
  const sha = computeContentSha(readFileSync(path));
  cache.set(key, sha);
  return sha;
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

interface ResolvedTopicFields {
  title: string;
  title_locked: boolean;
  short_summary: string;
  short_summary_locked: boolean;
  long_summary: string;
  long_summary_locked: boolean;
}

function resolveTopicLockedFields(
  existing: TopicFileNew | null,
  proposed: AnalyzeConversationOutput["conversation"]["topics"][number],
  confirmed: Set<string>,
  cleared: ConfirmedEdit[],
): ResolvedTopicFields {
  if (existing === null) {
    return {
      title: proposed.title,
      title_locked: false,
      short_summary: proposed.short_summary,
      short_summary_locked: false,
      long_summary: proposed.long_summary,
      long_summary_locked: false,
    };
  }
  return {
    ...resolveLockableField(
      { kind: "topic", topic_id: proposed.id, field: "title" },
      existing.title,
      existing.title_locked,
      proposed.title,
      confirmed,
      cleared,
      "title",
    ),
    ...resolveLockableField(
      { kind: "topic", topic_id: proposed.id, field: "short_summary" },
      existing.short_summary,
      existing.short_summary_locked,
      proposed.short_summary,
      confirmed,
      cleared,
      "short_summary",
    ),
    ...resolveLockableField(
      { kind: "topic", topic_id: proposed.id, field: "long_summary" },
      existing.long_summary,
      existing.long_summary_locked,
      proposed.long_summary,
      confirmed,
      cleared,
      "long_summary",
    ),
  };
}

interface ResolvedDecisionFields {
  title: string;
  title_locked: boolean;
  status: DecisionFileNew["status"];
  status_locked: boolean;
  context_text: string;
  context_text_locked: boolean;
  decision_text: string;
  decision_text_locked: boolean;
  decision_rationale: string;
  decision_rationale_locked: boolean;
}

function resolveDecisionLockedFields(
  existing: DecisionFileNew | null,
  proposed: AnalyzeConversationOutput["conversation"]["topics"][number]["decisions"][number],
  confirmed: Set<string>,
  cleared: ConfirmedEdit[],
): ResolvedDecisionFields {
  if (existing === null) {
    return {
      title: proposed.title,
      title_locked: false,
      status: proposed.status,
      status_locked: false,
      context_text: proposed.context.text,
      context_text_locked: false,
      decision_text: proposed.decision.text,
      decision_text_locked: false,
      decision_rationale: proposed.decision.rationale,
      decision_rationale_locked: false,
    };
  }
  const title = resolveLockableField(
    { kind: "decision", decision_id: proposed.id, field: "title" },
    existing.title,
    existing.title_locked,
    proposed.title,
    confirmed,
    cleared,
    "title",
  );
  const status = resolveLockableField(
    { kind: "decision", decision_id: proposed.id, field: "status" },
    existing.status,
    existing.status_locked,
    proposed.status,
    confirmed,
    cleared,
    "status",
  );
  const contextText = resolveLockableField(
    { kind: "decision", decision_id: proposed.id, field: "context.text" },
    existing.context.text,
    existing.context.text_locked,
    proposed.context.text,
    confirmed,
    cleared,
    "context_text",
  );
  const decisionText = resolveLockableField(
    { kind: "decision", decision_id: proposed.id, field: "decision.text" },
    existing.decision.text,
    existing.decision.text_locked,
    proposed.decision.text,
    confirmed,
    cleared,
    "decision_text",
  );
  const decisionRationale = resolveLockableField(
    { kind: "decision", decision_id: proposed.id, field: "decision.rationale" },
    existing.decision.rationale,
    existing.decision.rationale_locked,
    proposed.decision.rationale,
    confirmed,
    cleared,
    "decision_rationale",
  );
  return {
    title: title.title,
    title_locked: title.title_locked,
    status: status.status,
    status_locked: status.status_locked,
    context_text: contextText.context_text,
    context_text_locked: contextText.context_text_locked,
    decision_text: decisionText.decision_text,
    decision_text_locked: decisionText.decision_text_locked,
    decision_rationale: decisionRationale.decision_rationale,
    decision_rationale_locked: decisionRationale.decision_rationale_locked,
  };
}

function resolveLockableField<TName extends string, TValue>(
  edit: ConfirmedEdit,
  existingValue: TValue,
  existingLocked: boolean,
  proposedValue: TValue,
  confirmed: Set<string>,
  cleared: ConfirmedEdit[],
  resultName: TName,
): { [K in TName]: TValue } & { [K in `${TName}_locked`]: boolean } {
  let value = proposedValue;
  let locked = existingLocked;
  if (existingLocked && existingValue !== proposedValue) {
    if (confirmed.has(confirmedKey(edit))) {
      value = proposedValue;
      locked = false;
      cleared.push(edit);
    } else {
      value = existingValue;
      locked = true;
    }
  }
  return {
    [resultName]: value,
    [`${resultName}_locked`]: locked,
  } as { [K in TName]: TValue } & { [K in `${TName}_locked`]: boolean };
}

function inferConversationIdFromPath(absPath: string): string | null {
  const match = /\/conversations\/([^/]+)\.json$/.exec(absPath);
  return match === null ? null : match[1];
}
