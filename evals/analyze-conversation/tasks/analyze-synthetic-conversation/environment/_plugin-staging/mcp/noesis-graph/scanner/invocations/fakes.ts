import type { SerenaLike, SerenaReference } from "../../serena/serena.port.js";

export function makeFakeSerena(
  refsByKey: Record<string, SerenaReference[]>,
): SerenaLike {
  return {
    async findReferencingSymbols(namePath, relativePath) {
      return refsByKey[`${namePath}|${relativePath}`] ?? [];
    },
  };
}
