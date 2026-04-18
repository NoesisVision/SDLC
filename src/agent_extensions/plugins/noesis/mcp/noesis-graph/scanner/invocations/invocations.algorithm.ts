import type { InheritanceMap } from "../inheritance/inheritance.types.js";
import { ancestorsOf } from "../inheritance/inheritance.js";
import type { BehaviorRow, MethodDescriptor } from "./invocations.types.js";

export interface BehaviorInventory {
  byLocation: Map<string, BehaviorRow>;
  byTypeMethod: Map<string, BehaviorRow[]>;
}

export function sourcesFor(
  m: MethodDescriptor,
  inv: BehaviorInventory,
  inheritance: InheritanceMap,
): BehaviorRow[] {
  const sources: BehaviorRow[] = [];
  const seenIds = new Set<string>();

  const selfKey = `${m.filePath}:${m.typeName}:${m.methodName}`;
  const self = inv.byLocation.get(selfKey);
  if (self !== undefined) {
    sources.push(self);
    seenIds.add(self.id);
  }

  for (const ancestorTypeName of ancestorsOf(inheritance, m.typeName)) {
    const key = `${ancestorTypeName}:${m.methodName}`;
    const candidates = inv.byTypeMethod.get(key) ?? [];
    for (const c of candidates) {
      if (!seenIds.has(c.id)) {
        sources.push(c);
        seenIds.add(c.id);
      }
    }
  }

  return sources;
}
