import type { BoundedContext, Module } from "./domain-model/domain-model.js";

/*
 * The domain hierarchy is read off code namespaces — C# namespaces, Java
 * packages — the same way for every language: after the configured skips, the
 * first segment is the bounded context and every further segment a domain
 * module nested in the previous one.
 */

export function buildModuleHierarchy(namespaces: string[]): {
  boundedContexts: BoundedContext[];
  modules: Module[];
} {
  const uniquePaths = new Set<string>();
  for (const ns of namespaces) {
    const parts = ns.split(".");
    for (let i = 1; i <= parts.length; i++) {
      uniquePaths.add(parts.slice(0, i).join("."));
    }
  }

  const sortedPaths = [...uniquePaths].sort();
  const boundedContexts: BoundedContext[] = [];
  const modules: Module[] = [];

  for (const path of sortedPaths) {
    const parts = path.split(".");
    const name = parts[parts.length - 1];

    if (parts.length === 1) {
      boundedContexts.push({ name });
    } else {
      modules.push({ name, fullPath: path });
    }
  }

  return { boundedContexts, modules };
}

/** The deepest container (bounded context or module path) the namespace falls under; "" when none. */
export function findContainer(namespace: string, containerPaths: string[]): string {
  return containerPaths.find((p) => namespace.startsWith(p)) ?? "";
}

export function isExcluded(ns: string, excludePatterns: string[]): boolean {
  return excludePatterns.some((pattern) => pattern !== "" && matchesNamespacePattern(ns, pattern));
}

export function removeSkippedParts(ns: string, partsToSkip: string[]): string {
  if (ns === "") return "";
  let parts = ns.split(".");
  for (const pattern of partsToSkip) {
    if (pattern === "") continue;
    parts = removeContiguousSequence(parts, pattern.split("."));
  }
  return parts.join(".");
}

function matchesNamespacePattern(ns: string, pattern: string): boolean {
  const nsParts = ns.split(".");
  const patternParts = pattern.split(".");
  return matchPatternParts(patternParts, 0, nsParts, 0);
}

function matchPatternParts(
  patternParts: string[],
  pi: number,
  nsParts: string[],
  ni: number
): boolean {
  if (pi === patternParts.length) return ni === nsParts.length;
  const token = patternParts[pi];
  if (token === "*") {
    for (let k = 0; k <= nsParts.length - ni; k++) {
      if (matchPatternParts(patternParts, pi + 1, nsParts, ni + k)) return true;
    }
    return false;
  }
  if (ni === nsParts.length) return false;
  if (token !== nsParts[ni]) return false;
  return matchPatternParts(patternParts, pi + 1, nsParts, ni + 1);
}

function removeContiguousSequence(parts: string[], sequence: string[]): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < parts.length) {
    if (matchesAt(parts, i, sequence)) {
      i += sequence.length;
    } else {
      result.push(parts[i]);
      i++;
    }
  }
  return result;
}

function matchesAt(parts: string[], start: number, sequence: string[]): boolean {
  if (start + sequence.length > parts.length) return false;
  for (let j = 0; j < sequence.length; j++) {
    if (parts[start + j] !== sequence[j]) return false;
  }
  return true;
}
