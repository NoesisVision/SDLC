export function documentFragmentNodeId(
  documentId: string,
  startOffset: number,
  endOffset: number,
): string {
  return `${documentId}|F${startOffset}-${endOffset}`;
}
