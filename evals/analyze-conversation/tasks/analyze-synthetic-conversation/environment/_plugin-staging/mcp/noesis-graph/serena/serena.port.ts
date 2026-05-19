import type { MethodDescriptor } from "../scanner/invocations/invocation-graph.js";

export interface SerenaReference {
  enclosing: MethodDescriptor | null;
}

export interface SerenaLike {
  findReferencingSymbols(
    namePath: string,
    relativePath: string,
  ): Promise<SerenaReference[]>;
}
