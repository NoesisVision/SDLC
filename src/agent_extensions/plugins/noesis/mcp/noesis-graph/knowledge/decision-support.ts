export type DecisionSupportSlot =
  | { slot: "context" }
  | { slot: "decision" }
  | { slot: "alternative"; alternative_index: number };
