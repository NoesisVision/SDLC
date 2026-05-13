import type {
  DesignDocFileNew,
  DesignedActorNew,
  DesignedBehaviourNew,
  DesignedBoundedContextNew,
  DesignedBuildingBlockNew,
  DesignedDomainModuleNew,
  StringChangeSet,
} from "../../../../shared-contracts/design-doc-new.js";

// A design doc on disk represents the cumulative diff from the implemented codebase.
// `save_design_doc` uploads a *delta* against the canonical file: items the agent
// didn't mention must stay in place. This module folds that delta into the existing
// file so unmentioned items survive, while explicit slot transitions (e.g. an item
// moving from `added` to `modified`) take effect.

interface NamedChangeSet<T extends { name: string }> {
  added: T[];
  modified: T[];
  removed: string[];
}

type Slot = "added" | "modified" | "removed";

export function mergeDesignDocFiles(
  existing: DesignDocFileNew | null,
  incoming: DesignDocFileNew,
): DesignDocFileNew {
  if (existing === null) return incoming;
  return {
    ...incoming,
    actors: mergeActors(existing.actors, incoming.actors),
    boundedContexts: mergeNamedChangeSet(
      existing.boundedContexts,
      incoming.boundedContexts,
      mergeBoundedContext,
    ),
  };
}

function mergeActors(
  existing: DesignedActorNew[],
  incoming: DesignedActorNew[],
): DesignedActorNew[] {
  const byName = new Map<string, DesignedActorNew>();
  for (const a of existing) byName.set(a.name, a);
  for (const a of incoming) byName.set(a.name, a);
  return Array.from(byName.values());
}

function mergeBoundedContext(
  existing: DesignedBoundedContextNew,
  incoming: DesignedBoundedContextNew,
): DesignedBoundedContextNew {
  return {
    ...incoming,
    modules: mergeNamedChangeSet(
      existing.modules,
      incoming.modules,
      mergeModule,
    ),
    buildingBlocks: mergeNamedChangeSet(
      existing.buildingBlocks,
      incoming.buildingBlocks,
      mergeBuildingBlock,
    ),
    qualityAttributes: mergeNamedChangeSet(
      existing.qualityAttributes,
      incoming.qualityAttributes,
      pickIncoming,
    ),
  };
}

function mergeModule(
  existing: DesignedDomainModuleNew,
  incoming: DesignedDomainModuleNew,
): DesignedDomainModuleNew {
  return {
    ...incoming,
    buildingBlocks: mergeNamedChangeSet(
      existing.buildingBlocks,
      incoming.buildingBlocks,
      mergeBuildingBlock,
    ),
    qualityAttributes: mergeNamedChangeSet(
      existing.qualityAttributes,
      incoming.qualityAttributes,
      pickIncoming,
    ),
  };
}

function mergeBuildingBlock(
  existing: DesignedBuildingBlockNew,
  incoming: DesignedBuildingBlockNew,
): DesignedBuildingBlockNew {
  return {
    ...incoming,
    properties: mergeNamedChangeSet(
      existing.properties,
      incoming.properties,
      pickIncoming,
    ),
    behaviours: mergeNamedChangeSet(
      existing.behaviours,
      incoming.behaviours,
      mergeBehaviour,
    ),
    rules: mergeNamedChangeSet(
      existing.rules,
      incoming.rules,
      pickIncoming,
    ),
    scenarios: mergeNamedChangeSet(
      existing.scenarios,
      incoming.scenarios,
      pickIncoming,
    ),
    qualityAttributes: mergeNamedChangeSet(
      existing.qualityAttributes,
      incoming.qualityAttributes,
      pickIncoming,
    ),
  };
}

function mergeBehaviour(
  existing: DesignedBehaviourNew,
  incoming: DesignedBehaviourNew,
): DesignedBehaviourNew {
  return {
    ...incoming,
    input: mergeStringChangeSet(existing.input, incoming.input),
    output: mergeStringChangeSet(existing.output, incoming.output),
    usedBuildingBlocks: mergeStringChangeSet(
      existing.usedBuildingBlocks,
      incoming.usedBuildingBlocks,
    ),
    rules: mergeNamedChangeSet(existing.rules, incoming.rules, pickIncoming),
    scenarios: mergeNamedChangeSet(
      existing.scenarios,
      incoming.scenarios,
      pickIncoming,
    ),
    qualityAttributes: mergeNamedChangeSet(
      existing.qualityAttributes,
      incoming.qualityAttributes,
      pickIncoming,
    ),
  };
}

function pickIncoming<T>(_existing: T, incoming: T): T {
  return incoming;
}

function mergeNamedChangeSet<T extends { name: string }>(
  existing: NamedChangeSet<T> | undefined,
  incoming: NamedChangeSet<T> | undefined,
  mergeItem: (existing: T, incoming: T) => T,
): NamedChangeSet<T> | undefined {
  if (existing === undefined && incoming === undefined) return undefined;
  const e = existing ?? { added: [], modified: [], removed: [] };
  const i = incoming ?? { added: [], modified: [], removed: [] };
  const placement = new Map<string, { slot: Slot; data: T | null }>();
  for (const item of e.added) placement.set(item.name, { slot: "added", data: item });
  for (const item of e.modified) placement.set(item.name, { slot: "modified", data: item });
  for (const name of e.removed) placement.set(name, { slot: "removed", data: null });
  applyIncomingNamed(placement, "added", i.added, mergeItem);
  applyIncomingNamed(placement, "modified", i.modified, mergeItem);
  for (const name of i.removed) placement.set(name, { slot: "removed", data: null });
  const merged: NamedChangeSet<T> = { added: [], modified: [], removed: [] };
  for (const [name, entry] of placement) {
    switch (entry.slot) {
      case "added":
        if (entry.data !== null) merged.added.push(entry.data);
        break;
      case "modified":
        if (entry.data !== null) merged.modified.push(entry.data);
        break;
      case "removed":
        merged.removed.push(name);
        break;
    }
  }
  return merged;
}

function applyIncomingNamed<T extends { name: string }>(
  placement: Map<string, { slot: Slot; data: T | null }>,
  targetSlot: "added" | "modified",
  items: T[],
  mergeItem: (existing: T, incoming: T) => T,
): void {
  for (const item of items) {
    const prior = placement.get(item.name);
    const next =
      prior !== undefined && prior.data !== null
        ? mergeItem(prior.data, item)
        : item;
    placement.set(item.name, { slot: targetSlot, data: next });
  }
}

function mergeStringChangeSet(
  existing: StringChangeSet | undefined,
  incoming: StringChangeSet | undefined,
): StringChangeSet | undefined {
  if (existing === undefined && incoming === undefined) return undefined;
  const e = existing ?? { added: [], modified: [], removed: [] };
  const i = incoming ?? { added: [], modified: [], removed: [] };
  const placement = new Map<string, Slot>();
  for (const name of e.added) placement.set(name, "added");
  for (const name of e.modified) placement.set(name, "modified");
  for (const name of e.removed) placement.set(name, "removed");
  for (const name of i.added) placement.set(name, "added");
  for (const name of i.modified) placement.set(name, "modified");
  for (const name of i.removed) placement.set(name, "removed");
  const merged: StringChangeSet = { added: [], modified: [], removed: [] };
  for (const [name, slot] of placement) merged[slot].push(name);
  return merged;
}
