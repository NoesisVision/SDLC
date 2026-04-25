export function alternativeOptionNodeId(
  decisionId: string,
  optionIndex: number,
): string {
  return `${decisionId}|A${optionIndex}`;
}
