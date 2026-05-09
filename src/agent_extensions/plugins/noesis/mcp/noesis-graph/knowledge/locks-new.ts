import type {
  DecisionFileNew,
  TopicFileNew,
} from "../../../shared-contracts/source-file-schemas-new.js";
import type { DesignDocFileNew } from "../../../shared-contracts/design-doc-new.js";

export type TopicLockedField = "title" | "short_summary" | "long_summary";

export type DecisionLockedField =
  | "title"
  | "status"
  | "context.text"
  | "decision.text"
  | "decision.rationale";

export type DesignDocLockedField = "name" | "description";

export type ConfirmedEdit =
  | { kind: "topic"; topic_id: string; field: TopicLockedField }
  | { kind: "decision"; decision_id: string; field: DecisionLockedField }
  | { kind: "design_doc"; design_doc_id: string; field: DesignDocLockedField };

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

export function confirmedKey(edit: ConfirmedEdit): string {
  return formatConfirmedEdit(edit);
}

export function formatConfirmedEdit(edit: ConfirmedEdit): string {
  switch (edit.kind) {
    case "topic":
      return `topic:${edit.topic_id}.${edit.field}`;
    case "decision":
      return `decision:${edit.decision_id}.${edit.field}`;
    case "design_doc":
      return `design_doc:${edit.design_doc_id}.${edit.field}`;
  }
}

export interface TopicLockableShape {
  id: string;
  title: string;
  short_summary: string;
  long_summary: string;
}

export interface DecisionLockableShape {
  id: string;
  title: string;
  status: DecisionFileNew["status"];
  context: { text: string };
  decision: { text: string; rationale: string };
}

export interface DesignDocLockableShape {
  id: string;
  name: string;
  description: string;
}

export interface ResolvedTopicFields {
  title: string;
  title_locked: boolean;
  short_summary: string;
  short_summary_locked: boolean;
  long_summary: string;
  long_summary_locked: boolean;
}

export interface ResolvedDecisionFields {
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

export interface ResolvedDesignDocFields {
  name: string;
  name_locked: boolean;
  description: string;
  description_locked: boolean;
}

export function detectTopicConflicts(
  existing: TopicFileNew | null,
  proposed: TopicLockableShape,
): ConfirmedEdit[] {
  if (existing === null) return [];
  const out: ConfirmedEdit[] = [];
  if (existing.title_locked && existing.title !== proposed.title) {
    out.push({ kind: "topic", topic_id: proposed.id, field: "title" });
  }
  if (
    existing.short_summary_locked &&
    existing.short_summary !== proposed.short_summary
  ) {
    out.push({ kind: "topic", topic_id: proposed.id, field: "short_summary" });
  }
  if (
    existing.long_summary_locked &&
    existing.long_summary !== proposed.long_summary
  ) {
    out.push({ kind: "topic", topic_id: proposed.id, field: "long_summary" });
  }
  return out;
}

export function detectDecisionConflicts(
  existing: DecisionFileNew | null,
  proposed: DecisionLockableShape,
): ConfirmedEdit[] {
  if (existing === null) return [];
  const out: ConfirmedEdit[] = [];
  if (existing.title_locked && existing.title !== proposed.title) {
    out.push({ kind: "decision", decision_id: proposed.id, field: "title" });
  }
  if (existing.status_locked && existing.status !== proposed.status) {
    out.push({ kind: "decision", decision_id: proposed.id, field: "status" });
  }
  if (
    existing.context.text_locked &&
    existing.context.text !== proposed.context.text
  ) {
    out.push({
      kind: "decision",
      decision_id: proposed.id,
      field: "context.text",
    });
  }
  if (
    existing.decision.text_locked &&
    existing.decision.text !== proposed.decision.text
  ) {
    out.push({
      kind: "decision",
      decision_id: proposed.id,
      field: "decision.text",
    });
  }
  if (
    existing.decision.rationale_locked &&
    existing.decision.rationale !== proposed.decision.rationale
  ) {
    out.push({
      kind: "decision",
      decision_id: proposed.id,
      field: "decision.rationale",
    });
  }
  return out;
}

export function detectDesignDocConflicts(
  existing: DesignDocFileNew | null,
  proposed: DesignDocLockableShape,
): ConfirmedEdit[] {
  if (existing === null) return [];
  const out: ConfirmedEdit[] = [];
  if (existing.name_locked && existing.name !== proposed.name) {
    out.push({ kind: "design_doc", design_doc_id: proposed.id, field: "name" });
  }
  if (
    existing.description_locked &&
    existing.description !== proposed.description
  ) {
    out.push({
      kind: "design_doc",
      design_doc_id: proposed.id,
      field: "description",
    });
  }
  return out;
}

export function resolveTopicLockedFields(
  existing: TopicFileNew | null,
  proposed: TopicLockableShape,
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

export function resolveDecisionLockedFields(
  existing: DecisionFileNew | null,
  proposed: DecisionLockableShape,
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

export function resolveDesignDocLockedFields(
  existing: DesignDocFileNew | null,
  proposed: DesignDocLockableShape,
  confirmed: Set<string>,
  cleared: ConfirmedEdit[],
): ResolvedDesignDocFields {
  if (existing === null) {
    return {
      name: proposed.name,
      name_locked: false,
      description: proposed.description,
      description_locked: false,
    };
  }
  return {
    ...resolveLockableField(
      { kind: "design_doc", design_doc_id: proposed.id, field: "name" },
      existing.name,
      existing.name_locked,
      proposed.name,
      confirmed,
      cleared,
      "name",
    ),
    ...resolveLockableField(
      { kind: "design_doc", design_doc_id: proposed.id, field: "description" },
      existing.description,
      existing.description_locked,
      proposed.description,
      confirmed,
      cleared,
      "description",
    ),
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
