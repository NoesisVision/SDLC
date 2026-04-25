import type { TopicConversationIdeaUnit } from "../../../ui-contracts/topics/topics-data.js";

export interface TurnGroup {
  turn_index: number;
  speaker: string;
  time: string;
  idea_units: TopicConversationIdeaUnit[];
}

export function groupIdeaUnitsByTurn(
  ideaUnits: TopicConversationIdeaUnit[],
): TurnGroup[] {
  const groups = new Map<number, TurnGroup>();
  for (const iu of ideaUnits) {
    let group = groups.get(iu.turn_index);
    if (group === undefined) {
      group = {
        turn_index: iu.turn_index,
        speaker: iu.speaker,
        time: iu.time,
        idea_units: [],
      };
      groups.set(iu.turn_index, group);
    }
    group.idea_units.push(iu);
  }
  return Array.from(groups.values()).sort(
    (a, b) => a.turn_index - b.turn_index,
  );
}

export function categoryColor(category: string): string {
  switch (category) {
    case "Decision":
      return "noesisGreen";
    case "Position":
      return "noesisIndigo";
    case "Argument":
      return "yellow";
    case "Information":
      return "noesisBlue";
    default:
      return "gray";
  }
}
