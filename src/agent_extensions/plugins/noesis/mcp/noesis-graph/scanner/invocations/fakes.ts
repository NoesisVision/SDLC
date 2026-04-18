import type { SerenaLike, SerenaReference } from "./invocations.types.js";

export function makeFakeSerena(
  refsByKey: Record<string, SerenaReference[]>,
): SerenaLike {
  return {
    async findReferencingSymbols(namePath, relativePath) {
      return refsByKey[`${namePath}|${relativePath}`] ?? [];
    },
  };
}
