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
