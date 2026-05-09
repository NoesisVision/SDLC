import { Inject, Injectable } from "@nestjs/common";
import { rmSync } from "fs";
import type {
  DecisionFileNew,
  DecisionOptionNew,
  TopicItemRefNew,
} from "../../../../shared-contracts/source-file-schemas-new.js";
import { decisionJsonPath } from "../../../../shared-contracts/source-files.js";
import { PROJECT_DIR } from "../../config/config.module.js";
import type { SourceShaSnapshot } from "../topics/topics-new.service.js";
import { DecisionsRepositoryNew } from "./decisions-new.repository.js";

export interface DecisionEditableTopFields {
  title?: string;
  status?: "accepted" | "proposed";
  context_text?: string;
  decision_text?: string;
  decision_rationale?: string;
}

export interface AlternativeOptionEdit {
  index: number;
  text?: string;
  rationale?: string;
}

export interface IndexFileOutcome {
  status: "indexed" | "unchanged";
  decision_id: string;
}

export type DecisionLockedField =
  | "title"
  | "status"
  | "context.text"
  | "decision.text"
  | "decision.rationale"
  | `alternative_options[${number}].text`
  | `alternative_options[${number}].rationale`;

@Injectable()
export class DecisionsServiceNew {
  constructor(
    @Inject(PROJECT_DIR) private readonly projectDir: string,
    private readonly repository: DecisionsRepositoryNew,
  ) {}

  async appendReferencedItems(
    decisionId: string,
    items: TopicItemRefNew[],
  ): Promise<{ appended: number }> {
    if (items.length === 0) return { appended: 0 };
    const path = this.canonicalPath(decisionId);
    if (!this.repository.fileExists(path)) {
      throw new Error(`Decision file not found: ${path}`);
    }
    const file = this.repository.readFile(path);
    const seen = new Set(file.referenced_items.map(itemKey));
    const additions: TopicItemRefNew[] = [];
    for (const item of items) {
      const key = itemKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      additions.push(item);
    }
    if (additions.length === 0) return { appended: 0 };
    const nextFile: DecisionFileNew = {
      ...file,
      referenced_items: [...file.referenced_items, ...additions],
    };
    this.repository.writeFile(path, nextFile);
    return { appended: additions.length };
  }

  async deleteForFile(
    absPath: string,
  ): Promise<{ decision_id: string } | null> {
    const id = inferDecisionIdFromPath(absPath);
    if (id === null) return null;
    if (!(await this.repository.exists(id))) return null;
    await this.repository.delete(id);
    rmSync(decisionJsonPath(this.projectDir, id), { force: true });
    return { decision_id: id };
  }

  async editAlternativeOptionAndLock(
    decisionId: string,
    edit: AlternativeOptionEdit,
    confirmedByUser: boolean,
  ): Promise<{ updated: DecisionLockedField[] }> {
    const path = this.canonicalPath(decisionId);
    if (!this.repository.fileExists(path)) {
      throw new Error(`Decision file not found: ${path}`);
    }
    const file = this.repository.readFile(path);
    if (edit.index < 0 || edit.index >= file.alternative_options.length) {
      throw new Error(
        `Alternative option index ${edit.index} out of range (have ${file.alternative_options.length})`,
      );
    }
    const updated: DecisionLockedField[] = [];
    const updatedAlternatives = file.alternative_options.map((opt, i) => {
      if (i !== edit.index) return opt;
      let next = opt;
      if (edit.text !== undefined && next.text !== edit.text) {
        if (next.text_locked && !confirmedByUser) {
          throw new Error(
            `Decision ${decisionId}: alternative_options[${i}].text is locked; pass confirmedByUser=true to override.`,
          );
        }
        next = { ...next, text: edit.text, text_locked: true };
        updated.push(`alternative_options[${i}].text`);
      }
      if (edit.rationale !== undefined && next.rationale !== edit.rationale) {
        if (next.rationale_locked && !confirmedByUser) {
          throw new Error(
            `Decision ${decisionId}: alternative_options[${i}].rationale is locked; pass confirmedByUser=true to override.`,
          );
        }
        next = { ...next, rationale: edit.rationale, rationale_locked: true };
        updated.push(`alternative_options[${i}].rationale`);
      }
      return next;
    });
    if (updated.length === 0) return { updated: [] };
    const nextFile: DecisionFileNew = {
      ...file,
      alternative_options: updatedAlternatives,
    };
    this.repository.writeFile(path, nextFile);
    return { updated };
  }

  async editTopFieldsAndLock(
    decisionId: string,
    fields: DecisionEditableTopFields,
    confirmedByUser: boolean,
  ): Promise<{ updated: DecisionLockedField[] }> {
    const path = this.canonicalPath(decisionId);
    if (!this.repository.fileExists(path)) {
      throw new Error(`Decision file not found: ${path}`);
    }
    const file = this.repository.readFile(path);
    const updated: DecisionLockedField[] = [];
    let next: DecisionFileNew = file;
    if (fields.title !== undefined && file.title !== fields.title) {
      if (file.title_locked && !confirmedByUser) {
        throw new Error(
          `Decision ${file.id}: field "title" is locked; pass confirmedByUser=true to override.`,
        );
      }
      next = { ...next, title: fields.title, title_locked: true };
      updated.push("title");
    }
    if (fields.status !== undefined && file.status !== fields.status) {
      if (file.status_locked && !confirmedByUser) {
        throw new Error(
          `Decision ${file.id}: field "status" is locked; pass confirmedByUser=true to override.`,
        );
      }
      next = { ...next, status: fields.status, status_locked: true };
      updated.push("status");
    }
    if (fields.context_text !== undefined) {
      next = applyContextEdit(next, fields.context_text, confirmedByUser, updated);
    }
    if (fields.decision_text !== undefined) {
      next = applyDecisionTextEdit(next, fields.decision_text, confirmedByUser, updated);
    }
    if (fields.decision_rationale !== undefined) {
      next = applyDecisionRationaleEdit(
        next,
        fields.decision_rationale,
        confirmedByUser,
        updated,
      );
    }
    if (updated.length === 0) return { updated: [] };
    this.repository.writeFile(path, next);
    return { updated };
  }

  async indexFile(absPath: string): Promise<IndexFileOutcome> {
    const sha = this.repository.fileSha(absPath);
    const file = this.repository.readFile(absPath);
    const stored = await this.repository.read(file.id);
    if (stored !== null && stored.sha === sha) {
      return { status: "unchanged", decision_id: file.id };
    }
    await this.repository.upsert(file, sha);
    return { status: "indexed", decision_id: file.id };
  }

  async listAllStoredFiles(): Promise<
    Array<{ id: string; path: string; sha: string }>
  > {
    return this.repository.listAllStoredFiles(this.projectDir);
  }

  async readStaleFlag(decisionId: string): Promise<boolean | null> {
    return this.repository.readStaleFlag(decisionId);
  }

  async refreshStaleFlags(snapshot: SourceShaSnapshot): Promise<number> {
    const stored = await this.repository.listAll();
    let staleCount = 0;
    for (const decision of stored) {
      const path = this.canonicalPath(decision.id);
      if (!this.repository.fileExists(path)) continue;
      const file = this.repository.readFile(path);
      const isStale = computeStale(file.referenced_items, snapshot);
      if (isStale !== file.is_stale) {
        const updated: DecisionFileNew = { ...file, is_stale: isStale };
        this.repository.writeFile(path, updated);
      }
      if (isStale !== decision.is_stale) {
        await this.repository.writeStaleFlag(decision.id, isStale);
      }
      if (isStale) staleCount++;
    }
    return staleCount;
  }

  private canonicalPath(decisionId: string): string {
    return this.repository.canonicalPath(this.projectDir, decisionId);
  }
}

function applyContextEdit(
  file: DecisionFileNew,
  newText: string,
  confirmedByUser: boolean,
  updated: DecisionLockedField[],
): DecisionFileNew {
  if (file.context.text === newText) return file;
  if (file.context.text_locked && !confirmedByUser) {
    throw new Error(
      `Decision ${file.id}: context.text is locked; pass confirmedByUser=true to override.`,
    );
  }
  updated.push("context.text");
  return {
    ...file,
    context: { ...file.context, text: newText, text_locked: true },
  };
}

function applyDecisionTextEdit(
  file: DecisionFileNew,
  newText: string,
  confirmedByUser: boolean,
  updated: DecisionLockedField[],
): DecisionFileNew {
  return applyDecisionOptionEdit(
    file,
    "text",
    "text_locked",
    "decision.text",
    newText,
    confirmedByUser,
    updated,
  );
}

function applyDecisionRationaleEdit(
  file: DecisionFileNew,
  newText: string,
  confirmedByUser: boolean,
  updated: DecisionLockedField[],
): DecisionFileNew {
  return applyDecisionOptionEdit(
    file,
    "rationale",
    "rationale_locked",
    "decision.rationale",
    newText,
    confirmedByUser,
    updated,
  );
}

function applyDecisionOptionEdit(
  file: DecisionFileNew,
  fieldKey: "text" | "rationale",
  lockKey: "text_locked" | "rationale_locked",
  reportKey: "decision.text" | "decision.rationale",
  newValue: string,
  confirmedByUser: boolean,
  updated: DecisionLockedField[],
): DecisionFileNew {
  const opt: DecisionOptionNew = file.decision;
  if (opt[fieldKey] === newValue) return file;
  if (opt[lockKey] && !confirmedByUser) {
    throw new Error(
      `Decision ${file.id}: ${reportKey} is locked; pass confirmedByUser=true to override.`,
    );
  }
  updated.push(reportKey);
  return { ...file, decision: { ...opt, [fieldKey]: newValue, [lockKey]: true } };
}

function computeStale(
  items: TopicItemRefNew[],
  snapshot: SourceShaSnapshot,
): boolean {
  for (const item of items) {
    if (item.source_sha === undefined) continue;
    const currentSha =
      item.type === "idea_unit_ref"
        ? snapshot.conversation.get(item.conversation_id)
        : snapshot.document.get(item.document_id);
    if (currentSha !== undefined && currentSha !== item.source_sha) return true;
  }
  return false;
}

function itemKey(item: TopicItemRefNew): string {
  if (item.type === "idea_unit_ref") {
    return `iu:${item.conversation_id}:${item.turn_index}:${item.idea_unit_index}`;
  }
  return `doc:${item.document_id}:${item.start_offset}:${item.end_offset}`;
}

function inferDecisionIdFromPath(absPath: string): string | null {
  const match = /\/decisions\/([^/]+)\.json$/.exec(absPath);
  return match === null ? null : match[1];
}
