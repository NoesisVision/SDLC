export type DecisionSupportSlot =
  | { slot: "context" }
  | { slot: "decision" }
  | { slot: "alternative"; alternative_index: number };

export function alternativeOptionNodeId(
  decisionId: string,
  optionIndex: number,
): string {
  return `${decisionId}|A${optionIndex}`;
}

export function documentFragmentNodeId(
  documentId: string,
  startOffset: number,
  endOffset: number,
): string {
  return `${documentId}|F${startOffset}-${endOffset}`;
}

export function ideaUnitNodeId(
  conversationId: string,
  turnIndex: number,
  ideaUnitIndex: number,
): string {
  return `${conversationId}|T${turnIndex}|IU${ideaUnitIndex}`;
}

export function turnNodeId(conversationId: string, turnIndex: number): string {
  return `${conversationId}|T${turnIndex}`;
}
