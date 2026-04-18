import type { InheritanceMap } from "../inheritance/inheritance.types.js";
import { ancestorsOf } from "../inheritance/inheritance.js";
import type {
  BehaviorRow,
  Invocation,
  MethodDescriptor,
  SerenaLike,
} from "./invocations.types.js";

export interface BehaviorInventory {
  byLocation: Map<string, BehaviorRow>;
  byTypeMethod: Map<string, BehaviorRow[]>;
}

export interface ComputeInvocationsInput {
  behaviors: BehaviorRow[];
  inv: BehaviorInventory;
  inheritance: InheritanceMap;
  serena: SerenaLike;
}

export async function computeInvocations(
  input: ComputeInvocationsInput,
): Promise<Invocation[]> {
  const edges = new Map<string, Invocation>();
  for (const b of input.behaviors) {
    await walkForBehavior(b, input, edges);
  }
  return Array.from(edges.values());
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

async function walkForBehavior(
  destination: BehaviorRow,
  input: ComputeInvocationsInput,
  edges: Map<string, Invocation>,
): Promise<void> {
  const visited = new Set<string>();
  const queue: MethodDescriptor[] = [
    {
      filePath: destination.filePath,
      typeName: destination.typeName,
      methodName: destination.methodName,
    },
  ];

  while (queue.length > 0) {
    const target = queue.shift()!;
    const targetKey = methodKey(target);
    if (visited.has(targetKey)) continue;
    visited.add(targetKey);

    const namePath = `${target.typeName}/${target.methodName}`;
    const refs = await input.serena.findReferencingSymbols(
      namePath,
      target.filePath,
    );

    for (const r of refs) {
      if (r.enclosing === null) continue;
      const sources = sourcesFor(r.enclosing, input.inv, input.inheritance);
      if (sources.length > 0) {
        for (const s of sources) {
          const edgeKey = `${s.id}->${destination.id}`;
          if (!edges.has(edgeKey)) {
            edges.set(edgeKey, { source: s.id, destination: destination.id });
          }
        }
      } else {
        queue.push(r.enclosing);
      }
    }
  }
}

function methodKey(m: MethodDescriptor): string {
  return `${m.filePath}:${m.typeName}:${m.methodName}`;
}
