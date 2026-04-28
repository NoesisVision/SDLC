import { z } from "zod";
import {
  AnalyzeConversationOutputSchema,
  type AnalyzeConversationOutput,
} from "../../../../shared-contracts/skills/analyze-conversation/output.js";
import { isIrrelevant } from "../../../../shared-contracts/conversation.js";
import { assertNever } from "../../../../shared-contracts/assert-never.js";

export const FIRST_LEVEL_BREADTH_THRESHOLD = 10;
export const TOPIC_OWN_ITEM_WARN_THRESHOLD = 25;

export type ValidationPath = (string | number)[];

export interface ValidationIssue {
  path: ValidationPath;
  message: string;
}

export type ValidationResult =
  | { status: "Ok"; warnings: ValidationIssue[] }
  | { status: "Errors"; errors: ValidationIssue[]; warnings: ValidationIssue[] };

export interface GraphLookup {
  topicExists(id: string): Promise<boolean>;
}

export async function validateAnalyzeConversationOutput(
  raw: unknown,
  graph: GraphLookup,
): Promise<ValidationResult> {
  const parsed = AnalyzeConversationOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "Errors",
      errors: zodIssuesToErrors(parsed.error),
      warnings: [],
    };
  }

  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const output = parsed.data;

  errors.push(...checkIdeaUnitAssignmentCoverage(output));
  errors.push(...(await checkTopicIdConsistency(output, graph)));
  errors.push(...checkReferenceIntegrity(output));
  errors.push(...(await checkTopicForestIntegrity(output, graph)));

  warnings.push(...(await checkFirstLevelBreadth(output, graph)));
  warnings.push(...checkOwnItemCountWarning(output));

  if (errors.length === 0) {
    return { status: "Ok", warnings };
  }
  return { status: "Errors", errors, warnings };
}

function zodIssuesToErrors(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: [...issue.path] as ValidationPath,
    message: issue.message,
  }));
}

function checkIdeaUnitAssignmentCoverage(
  output: AnalyzeConversationOutput,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { conversation } = output;

  const nonIrrelevant = new Set<string>();
  const irrelevant = new Set<string>();
  for (const turn of conversation.turns) {
    for (const iu of turn.idea_units) {
      const key = `${turn.index}:${iu.index}`;
      if (isIrrelevant(iu.categories)) irrelevant.add(key);
      else nonIrrelevant.add(key);
    }
  }

  const assignmentsByKey = new Map<string, ValidationPath[]>();
  for (let ti = 0; ti < conversation.topics.length; ti++) {
    const topic = conversation.topics[ti];
    for (let ii = 0; ii < topic.items.length; ii++) {
      const item = topic.items[ii];
      switch (item.type) {
        case "idea_unit_ref": {
          if (item.conversation_id !== conversation.conversation_id) break;
          const key = `${item.turn_index}:${item.idea_unit_index}`;
          const path: ValidationPath = [
            "conversation",
            "topics",
            ti,
            "items",
            ii,
          ];
          const list = assignmentsByKey.get(key) ?? [];
          list.push(path);
          assignmentsByKey.set(key, list);
          break;
        }
        case "document_fragment_ref":
          break;
        default:
          assertNever(item);
      }
    }
  }

  for (const key of nonIrrelevant) {
    if (!assignmentsByKey.has(key)) {
      const [turnIndex, ideaUnitIndex] = key.split(":");
      issues.push({
        path: ["conversation", "topics"],
        message:
          `Idea unit (turn=${turnIndex}, idea_unit=${ideaUnitIndex}) is non-Irrelevant ` +
          `but not assigned to any topic.`,
      });
    }
  }

  for (const [key, paths] of assignmentsByKey) {
    if (irrelevant.has(key)) {
      const [turnIndex, ideaUnitIndex] = key.split(":");
      for (const path of paths) {
        issues.push({
          path,
          message:
            `Idea unit (turn=${turnIndex}, idea_unit=${ideaUnitIndex}) is Irrelevant ` +
            `and must not be assigned to any topic.`,
        });
      }
    }
    if (paths.length > 1 && !irrelevant.has(key)) {
      const [turnIndex, ideaUnitIndex] = key.split(":");
      for (const path of paths) {
        issues.push({
          path,
          message:
            `Idea unit (turn=${turnIndex}, idea_unit=${ideaUnitIndex}) is assigned ` +
            `${paths.length} times; each non-Irrelevant idea unit must be assigned to exactly one topic.`,
        });
      }
    }
  }

  return issues;
}

async function checkTopicIdConsistency(
  output: AnalyzeConversationOutput,
  graph: GraphLookup,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const conversationTopicIds = new Map<string, number>();
  output.conversation.topics.forEach((t, i) => conversationTopicIds.set(t.id, i));

  const potentialById = new Map<string, { index: number; isNew: boolean }>();
  output.potential_topics.topics.forEach((t, i) =>
    potentialById.set(t.id, { index: i, isNew: t.is_new }),
  );

  for (const [pId, info] of potentialById) {
    if (info.isNew && !conversationTopicIds.has(pId)) {
      issues.push({
        path: ["potential_topics", "topics", info.index],
        message:
          `potential_topics entry id="${pId}" is marked is_new: true but has no matching ` +
          `entry in conversation.topics with the same id.`,
      });
    }
  }

  for (const [tId, ti] of conversationTopicIds) {
    const existsInGraph = await graph.topicExists(tId);
    const potential = potentialById.get(tId);
    if (!existsInGraph) {
      if (potential === undefined || !potential.isNew) {
        issues.push({
          path: ["conversation", "topics", ti],
          message:
            `Topic id="${tId}" is not in the graph and is not declared as new in ` +
            `potential_topics.topics (with is_new: true).`,
        });
      }
    }
  }

  return issues;
}

function checkReferenceIntegrity(
  output: AnalyzeConversationOutput,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { conversation } = output;
  const ideaUnitKeys = new Set<string>();
  for (const turn of conversation.turns) {
    for (const iu of turn.idea_units) {
      ideaUnitKeys.add(`${turn.index}:${iu.index}`);
    }
  }

  for (let ti = 0; ti < conversation.topics.length; ti++) {
    const topic = conversation.topics[ti];
    for (let ii = 0; ii < topic.items.length; ii++) {
      const item = topic.items[ii];
      switch (item.type) {
        case "idea_unit_ref": {
          if (item.conversation_id !== conversation.conversation_id) {
            issues.push({
              path: ["conversation", "topics", ti, "items", ii],
              message:
                `Topic items must reference the current conversation's idea units only; ` +
                `prior-conversation references are managed by the server.`,
            });
            break;
          }
          if (!ideaUnitKeys.has(`${item.turn_index}:${item.idea_unit_index}`)) {
            issues.push({
              path: ["conversation", "topics", ti, "items", ii],
              message:
                `Idea unit reference (turn=${item.turn_index}, ` +
                `idea_unit=${item.idea_unit_index}) does not exist in conversation.turns.`,
            });
          }
          break;
        }
        case "document_fragment_ref":
          break;
        default:
          assertNever(item);
      }
    }
    for (let di = 0; di < topic.decisions.length; di++) {
      const decision = topic.decisions[di];
      for (let ri = 0; ri < decision.referenced_items.length; ri++) {
        const ref = decision.referenced_items[ri];
        switch (ref.type) {
          case "idea_unit_ref": {
            if (ref.conversation_id !== conversation.conversation_id) {
              issues.push({
                path: [
                  "conversation",
                  "topics",
                  ti,
                  "decisions",
                  di,
                  "referenced_items",
                  ri,
                ],
                message:
                  `Decision referenced_items must reference the current conversation only.`,
              });
              break;
            }
            if (!ideaUnitKeys.has(`${ref.turn_index}:${ref.idea_unit_index}`)) {
              issues.push({
                path: [
                  "conversation",
                  "topics",
                  ti,
                  "decisions",
                  di,
                  "referenced_items",
                  ri,
                ],
                message:
                  `Decision referenced_items[${ri}] points at an idea unit ` +
                  `(turn=${ref.turn_index}, idea_unit=${ref.idea_unit_index}) ` +
                  `that does not exist in conversation.turns.`,
              });
            }
            break;
          }
          case "document_fragment_ref":
            break;
          default:
            assertNever(ref);
        }
      }
    }
  }

  return issues;
}

async function checkTopicForestIntegrity(
  output: AnalyzeConversationOutput,
  graph: GraphLookup,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const idsInOutput = new Set(output.conversation.topics.map((t) => t.id));
  const parentMap = new Map<string, { index: number; parentId: string | null }>();
  output.potential_topics.topics.forEach((t, i) => {
    parentMap.set(t.id, { index: i, parentId: t.parent_id });
  });

  for (const [id, info] of parentMap) {
    if (info.parentId === null) continue;
    if (idsInOutput.has(info.parentId)) continue;
    const parentExists = await graph.topicExists(info.parentId);
    if (!parentExists) {
      issues.push({
        path: ["potential_topics", "topics", info.index, "parent_id"],
        message:
          `parent_id="${info.parentId}" of topic "${id}" is neither another topic in ` +
          `this output.json nor an existing topic in the graph.`,
      });
    }
  }

  for (const [id, info] of parentMap) {
    if (info.parentId === null) continue;
    if (!idsInOutput.has(info.parentId)) continue;
    const seen = new Set<string>();
    let cursor: string | null = id;
    while (cursor !== null) {
      if (seen.has(cursor)) {
        issues.push({
          path: ["potential_topics", "topics", info.index, "parent_id"],
          message: `Cycle detected in topic forest at topic "${id}".`,
        });
        break;
      }
      seen.add(cursor);
      const next = parentMap.get(cursor);
      cursor =
        next !== undefined && next.parentId !== null && idsInOutput.has(next.parentId)
          ? next.parentId
          : null;
    }
  }

  return issues;
}

async function checkFirstLevelBreadth(
  output: AnalyzeConversationOutput,
  graph: GraphLookup,
): Promise<ValidationIssue[]> {
  const warnings: ValidationIssue[] = [];
  const idsInOutput = new Set(output.conversation.topics.map((t) => t.id));
  const parentLookup = new Map<string, string | null>();
  output.potential_topics.topics.forEach((t) => parentLookup.set(t.id, t.parent_id));

  let firstLevelCount = 0;
  for (const topic of output.conversation.topics) {
    const parentId = parentLookup.get(topic.id) ?? null;
    if (parentId === null) {
      firstLevelCount++;
      continue;
    }
    if (!idsInOutput.has(parentId) && !(await graph.topicExists(parentId))) {
      firstLevelCount++;
    }
  }
  if (firstLevelCount > FIRST_LEVEL_BREADTH_THRESHOLD) {
    warnings.push({
      path: ["conversation", "topics"],
      message:
        `First-level breadth is ${firstLevelCount} (threshold ` +
        `${FIRST_LEVEL_BREADTH_THRESHOLD}). Consider grouping siblings under a coarser parent.`,
    });
  }
  return warnings;
}

function checkOwnItemCountWarning(
  output: AnalyzeConversationOutput,
): ValidationIssue[] {
  const warnings: ValidationIssue[] = [];
  const conversationId = output.conversation.conversation_id;
  output.conversation.topics.forEach((topic, ti) => {
    let ownNonIrrelevant = 0;
    for (const item of topic.items) {
      if (item.type !== "idea_unit_ref") continue;
      if (item.conversation_id !== conversationId) continue;
      const turn = output.conversation.turns.find(
        (t) => t.index === item.turn_index,
      );
      const iu = turn?.idea_units.find((u) => u.index === item.idea_unit_index);
      if (iu === undefined) continue;
      if (isIrrelevant(iu.categories)) continue;
      ownNonIrrelevant++;
    }
    if (ownNonIrrelevant > TOPIC_OWN_ITEM_WARN_THRESHOLD) {
      warnings.push({
        path: ["conversation", "topics", ti],
        message:
          `Topic "${topic.id}" ('${topic.title}') has ${ownNonIrrelevant} own items. ` +
          `Verify it covers a single concept; consider splitting if items cluster around ` +
          `multiple distinct sub-themes.`,
      });
    }
  });
  return warnings;
}
