import { z } from "zod";
import { TopicSchema } from "./topics.js";

export { IdeaUnitCategory } from "./idea-unit-category.js";
import { IdeaUnitCategory } from "./idea-unit-category.js";

export const IdeaUnitSchema = z.object({
  index: z.int(),
  sentences: z.array(z.string()),
  categories: z.array(IdeaUnitCategory),
});
export type IdeaUnit = z.infer<typeof IdeaUnitSchema>;

export const IdeaUnitRefSchema = z.object({
  type: z.literal("idea_unit_ref"),
  conversation_id: z.string(),
  turn_index: z.int(),
  idea_unit_index: z.int(),
});
export type IdeaUnitRef = z.infer<typeof IdeaUnitRefSchema>;

export const TurnSchema = z.object({
  index: z.int(),
  speaker: z.string(),
  time: z.string(),
  idea_units: z.array(IdeaUnitSchema),
});
export type Turn = z.infer<typeof TurnSchema>;

export const ConversationSchema = z.object({
  conversation_id: z.string(),
  time: z.string(),
  main_topic: z.string(),
  turns: z.array(TurnSchema),
  topics: z.array(z.lazy(() => TopicSchema)),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const IdeaUnitDetailSchema = z.object({
  conversation_id: z.string(),
  turn_index: z.int(),
  idea_unit_index: z.int(),
  speaker: z.string(),
  time: z.string(),
  sentences: z.array(z.string()),
  categories: z.array(IdeaUnitCategory),
});
export type IdeaUnitDetail = z.infer<typeof IdeaUnitDetailSchema>;

export const EnrichedSubtopicSchema = z.object({
  id: z.string(),
  title: z.string(),
  short_summary: z.string(),
  reviewed: z.boolean(),
});
export type EnrichedSubtopic = z.infer<typeof EnrichedSubtopicSchema>;

export const EnrichedTopicSchema = z.object({
  id: z.string(),
  title: z.string(),
  short_summary: z.string(),
  long_summary: z.string(),
  conversation_id: z.string(),
  idea_units: z.array(IdeaUnitDetailSchema),
  subtopics: z.array(EnrichedSubtopicSchema),
});
export type EnrichedTopic = z.infer<typeof EnrichedTopicSchema>;

// --- Domain functions ---

export function buildTurnMap(turns: Turn[]): Map<number, Turn> {
  return new Map(turns.map((t) => [t.index, t]));
}

function findIdeaUnit(turn: Turn, ideaUnitIndex: number): IdeaUnit | null {
  return turn.idea_units.find((iu) => iu.index === ideaUnitIndex) ?? null;
}

export function isIrrelevant(categories: IdeaUnitCategory[]): boolean {
  return categories.length === 1 && categories[0] === "Irrelevant";
}

export function resolveIdeaUnitDetail(
  ref: { conversation_id: string; turn_index: number; idea_unit_index: number },
  turnMap: Map<number, Turn>,
): IdeaUnitDetail | null {
  const turn = turnMap.get(ref.turn_index);
  if (turn === undefined) return null;
  const ideaUnit = findIdeaUnit(turn, ref.idea_unit_index);
  if (ideaUnit === null) return null;
  return {
    conversation_id: ref.conversation_id,
    turn_index: ref.turn_index,
    idea_unit_index: ref.idea_unit_index,
    speaker: turn.speaker,
    time: turn.time,
    sentences: ideaUnit.sentences,
    categories: ideaUnit.categories,
  };
}

export function formatEnrichedTopicMarkdown(topic: EnrichedTopic): string {
  const lines: string[] = [];
  lines.push(`# ${topic.title}`);
  lines.push(`- **ID:** ${topic.id}`);
  lines.push(`- **Conversation:** ${topic.conversation_id}`);
  lines.push(`- **Summary:** ${topic.short_summary}`);
  if (topic.long_summary) {
    lines.push(`- **Long summary:** ${topic.long_summary}`);
  }
  lines.push("");

  if (topic.subtopics.length > 0) {
    lines.push("## Subtopics");
    lines.push("");
    for (const sub of topic.subtopics) {
      const summary = sub.reviewed && sub.short_summary !== ""
        ? sub.short_summary
        : "_(pending review)_";
      lines.push(`- **${sub.title}** — ${summary}`);
    }
    lines.push("");
  }

  lines.push("## Idea Units");
  lines.push("");

  for (const iu of topic.idea_units) {
    const cats = iu.categories.join(", ");
    const kgTag = iu.conversation_id !== topic.conversation_id ? " [prior conversation]" : "";
    lines.push(`### [T${iu.turn_index}:IU${iu.idea_unit_index}] ${iu.time} — ${iu.speaker} [${cats}]${kgTag}`);
    lines.push(iu.sentences.join(" "));
    lines.push("");
  }

  return lines.join("\n");
}
