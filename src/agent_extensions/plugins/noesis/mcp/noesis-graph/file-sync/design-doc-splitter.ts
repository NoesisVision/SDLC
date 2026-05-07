import { existsSync, readFileSync, unlinkSync } from "fs";
import {
  DesignDocSchema,
  type DesignDoc,
  type DesignedBehaviour,
  type DesignedBoundedContext,
  type DesignedBuildingBlock,
  type DesignedDomainModule,
  type DesignedQualityAttribute,
  type DesignedRule,
  type DesignedScenario,
} from "../../../shared-contracts/design-doc.js";
import {
  designDocCanonicalPath,
  ensureNoesisLayout,
  findDesignDocFileById,
  readSidecar,
  writeSidecar,
} from "../../../shared-contracts/source-files.js";

export interface CommitDesignDocOptions {
  projectDir: string;
  confirmedEdits?: ReadonlySet<string>;
}

export interface CommitDesignDocResult {
  canonical_path: string;
}

export class UserEditConflictError extends Error {
  constructor(public readonly blockedPaths: string[]) {
    super(
      `Save blocked: ${blockedPaths.length} user-edited element(s) would be overwritten without confirmation: ${blockedPaths.join(", ")}`,
    );
    this.name = "UserEditConflictError";
  }
}

export class UserDroppedItemsError extends Error {
  constructor(public readonly droppedPaths: string[]) {
    super(
      `Save blocked: ${droppedPaths.length} element(s) present in the prior version are missing from the submitted version without confirmation: ${droppedPaths.join(", ")}`,
    );
    this.name = "UserDroppedItemsError";
  }
}

export function commitDesignDoc(
  designDoc: DesignDoc,
  options: CommitDesignDocOptions,
): CommitDesignDocResult {
  ensureNoesisLayout(options.projectDir);
  const target = designDocCanonicalPath(
    options.projectDir,
    designDoc.id,
    designDoc.name,
  );
  const renamedFromPath = findDesignDocFileById(
    options.projectDir,
    designDoc.id,
    new Set([target]),
  );
  const prev =
    renamedFromPath !== null && existsSync(renamedFromPath)
      ? loadIfExists(renamedFromPath)
      : null;

  const confirmedEdits = options.confirmedEdits ?? new Set<string>();

  const blocked = collectBlockedEdits(prev, designDoc, confirmedEdits);
  if (blocked.length > 0) {
    throw new UserEditConflictError(blocked);
  }

  const cleaned = stripDocFlags(designDoc);
  if (prev !== null && prev.implemented === true) {
    cleaned.implemented = true;
  }
  writeSidecar(target, cleaned, DesignDocSchema);

  if (renamedFromPath !== null && renamedFromPath !== target && existsSync(renamedFromPath)) {
    try {
      unlinkSync(renamedFromPath);
    } catch {
      // best-effort
    }
  }

  return { canonical_path: target };
}

export function collectDroppedPaths(
  prev: DesignDoc | null,
  next: DesignDoc,
  confirmed: ReadonlySet<string>,
): string[] {
  if (prev === null) return [];
  const dropped: string[] = [];
  walkDroppedBoundedContexts(
    prev.boundedContexts,
    next.boundedContexts,
    "boundedContexts",
    confirmed,
    dropped,
  );
  return dropped;
}

export function readDesignDocBytesForSha(target: string): Buffer {
  return readFileSync(target);
}

function loadIfExists(path: string): DesignDoc | null {
  if (!existsSync(path)) return null;
  try {
    return readSidecar(path, DesignDocSchema);
  } catch {
    return null;
  }
}

interface ChangeSet<T> {
  added: T[];
  modified: T[];
  removed: string[];
}

interface ElementWithFlag {
  name: string;
  edited_by_user?: boolean;
}

function walkDroppedBoundedContexts(
  prev: ChangeSet<DesignedBoundedContext> | undefined,
  next: ChangeSet<DesignedBoundedContext> | undefined,
  basePath: string,
  confirmed: ReadonlySet<string>,
  dropped: string[],
): void {
  if (prev === undefined) return;
  const nextByName = nameMap(next?.added ?? []);
  for (const bc of prev.added) {
    const path = `${basePath}/${bc.name}`;
    const nextBC = nextByName.get(bc.name);
    if (nextBC === undefined) {
      flagDrop(path, confirmed, dropped);
      continue;
    }
    walkDroppedBCChildren(bc, nextBC, path, confirmed, dropped);
  }
}

function walkDroppedBCChildren(
  prev: DesignedBoundedContext,
  next: DesignedBoundedContext,
  basePath: string,
  confirmed: ReadonlySet<string>,
  dropped: string[],
): void {
  walkDroppedModules(
    prev.modules,
    next.modules,
    `${basePath}/modules`,
    confirmed,
    dropped,
  );
  walkDroppedBuildingBlocks(
    prev.buildingBlocks,
    next.buildingBlocks,
    `${basePath}/buildingBlocks`,
    confirmed,
    dropped,
  );
  walkDroppedFlat<DesignedQualityAttribute>(
    prev.qualityAttributes,
    next.qualityAttributes,
    `${basePath}/qualityAttributes`,
    confirmed,
    dropped,
  );
}

function walkDroppedModules(
  prev: ChangeSet<DesignedDomainModule> | undefined,
  next: ChangeSet<DesignedDomainModule> | undefined,
  basePath: string,
  confirmed: ReadonlySet<string>,
  dropped: string[],
): void {
  if (prev === undefined) return;
  const nextByName = nameMap(next?.added ?? []);
  for (const mod of prev.added) {
    const path = `${basePath}/${mod.name}`;
    const nextMod = nextByName.get(mod.name);
    if (nextMod === undefined) {
      flagDrop(path, confirmed, dropped);
      continue;
    }
    walkDroppedBuildingBlocks(
      mod.buildingBlocks,
      nextMod.buildingBlocks,
      `${path}/buildingBlocks`,
      confirmed,
      dropped,
    );
    walkDroppedFlat<DesignedQualityAttribute>(
      mod.qualityAttributes,
      nextMod.qualityAttributes,
      `${path}/qualityAttributes`,
      confirmed,
      dropped,
    );
  }
}

function walkDroppedBuildingBlocks(
  prev: ChangeSet<DesignedBuildingBlock> | undefined,
  next: ChangeSet<DesignedBuildingBlock> | undefined,
  basePath: string,
  confirmed: ReadonlySet<string>,
  dropped: string[],
): void {
  if (prev === undefined) return;
  const nextByName = nameMap(next?.added ?? []);
  for (const bb of prev.added) {
    const path = `${basePath}/${bb.name}`;
    const nextBB = nextByName.get(bb.name);
    if (nextBB === undefined) {
      flagDrop(path, confirmed, dropped);
      continue;
    }
    walkDroppedBehaviours(
      bb.behaviours,
      nextBB.behaviours,
      `${path}/behaviours`,
      confirmed,
      dropped,
    );
    walkDroppedFlat<DesignedRule>(
      bb.rules,
      nextBB.rules,
      `${path}/rules`,
      confirmed,
      dropped,
    );
    walkDroppedFlat<DesignedScenario>(
      bb.scenarios,
      nextBB.scenarios,
      `${path}/scenarios`,
      confirmed,
      dropped,
    );
    walkDroppedFlat<DesignedQualityAttribute>(
      bb.qualityAttributes,
      nextBB.qualityAttributes,
      `${path}/qualityAttributes`,
      confirmed,
      dropped,
    );
  }
}

function walkDroppedBehaviours(
  prev: ChangeSet<DesignedBehaviour> | undefined,
  next: ChangeSet<DesignedBehaviour> | undefined,
  basePath: string,
  confirmed: ReadonlySet<string>,
  dropped: string[],
): void {
  if (prev === undefined) return;
  const nextByName = nameMap(next?.added ?? []);
  for (const bh of prev.added) {
    const path = `${basePath}/${bh.name}`;
    const nextBH = nextByName.get(bh.name);
    if (nextBH === undefined) {
      flagDrop(path, confirmed, dropped);
      continue;
    }
    walkDroppedFlat<DesignedRule>(
      bh.rules,
      nextBH.rules,
      `${path}/rules`,
      confirmed,
      dropped,
    );
    walkDroppedFlat<DesignedScenario>(
      bh.scenarios,
      nextBH.scenarios,
      `${path}/scenarios`,
      confirmed,
      dropped,
    );
    walkDroppedFlat<DesignedQualityAttribute>(
      bh.qualityAttributes,
      nextBH.qualityAttributes,
      `${path}/qualityAttributes`,
      confirmed,
      dropped,
    );
  }
}

function walkDroppedFlat<T extends ElementWithFlag>(
  prev: ChangeSet<T> | undefined,
  next: ChangeSet<T> | undefined,
  basePath: string,
  confirmed: ReadonlySet<string>,
  dropped: string[],
): void {
  if (prev === undefined) return;
  const nextByName = nameMap(next?.added ?? []);
  for (const item of prev.added) {
    const path = `${basePath}/${item.name}`;
    if (!nextByName.has(item.name)) {
      flagDrop(path, confirmed, dropped);
    }
  }
}

function flagDrop(
  path: string,
  confirmed: ReadonlySet<string>,
  dropped: string[],
): void {
  if (confirmed.has(path)) return;
  dropped.push(path);
}

function collectBlockedEdits(
  prev: DesignDoc | null,
  next: DesignDoc,
  confirmed: ReadonlySet<string>,
): string[] {
  if (prev === null) return [];
  const blocked: string[] = [];
  walkBlockedBoundedContexts(
    prev.boundedContexts,
    next.boundedContexts,
    "boundedContexts",
    confirmed,
    blocked,
  );
  return blocked;
}

function walkBlockedBoundedContexts(
  prev: ChangeSet<DesignedBoundedContext> | undefined,
  next: ChangeSet<DesignedBoundedContext> | undefined,
  basePath: string,
  confirmed: ReadonlySet<string>,
  blocked: string[],
): void {
  if (prev === undefined || next === undefined) return;
  const nextByName = nameMap(next.added);
  for (const bc of prev.added) {
    const nextBC = nextByName.get(bc.name);
    if (nextBC === undefined) continue;
    const path = `${basePath}/${bc.name}`;
    flagIfBlocked(bc, path, confirmed, blocked);
    walkBlockedBCChildren(bc, nextBC, path, confirmed, blocked);
  }
}

function walkBlockedBCChildren(
  prev: DesignedBoundedContext,
  next: DesignedBoundedContext,
  basePath: string,
  confirmed: ReadonlySet<string>,
  blocked: string[],
): void {
  walkBlockedModules(
    prev.modules,
    next.modules,
    `${basePath}/modules`,
    confirmed,
    blocked,
  );
  walkBlockedBuildingBlocks(
    prev.buildingBlocks,
    next.buildingBlocks,
    `${basePath}/buildingBlocks`,
    confirmed,
    blocked,
  );
  walkBlockedFlat<DesignedQualityAttribute>(
    prev.qualityAttributes,
    next.qualityAttributes,
    `${basePath}/qualityAttributes`,
    confirmed,
    blocked,
  );
}

function walkBlockedModules(
  prev: ChangeSet<DesignedDomainModule> | undefined,
  next: ChangeSet<DesignedDomainModule> | undefined,
  basePath: string,
  confirmed: ReadonlySet<string>,
  blocked: string[],
): void {
  if (prev === undefined || next === undefined) return;
  const nextByName = nameMap(next.added);
  for (const mod of prev.added) {
    const nextMod = nextByName.get(mod.name);
    if (nextMod === undefined) continue;
    const path = `${basePath}/${mod.name}`;
    flagIfBlocked(mod, path, confirmed, blocked);
    walkBlockedBuildingBlocks(
      mod.buildingBlocks,
      nextMod.buildingBlocks,
      `${path}/buildingBlocks`,
      confirmed,
      blocked,
    );
    walkBlockedFlat<DesignedQualityAttribute>(
      mod.qualityAttributes,
      nextMod.qualityAttributes,
      `${path}/qualityAttributes`,
      confirmed,
      blocked,
    );
  }
}

function walkBlockedBuildingBlocks(
  prev: ChangeSet<DesignedBuildingBlock> | undefined,
  next: ChangeSet<DesignedBuildingBlock> | undefined,
  basePath: string,
  confirmed: ReadonlySet<string>,
  blocked: string[],
): void {
  if (prev === undefined || next === undefined) return;
  const nextByName = nameMap(next.added);
  for (const bb of prev.added) {
    const nextBB = nextByName.get(bb.name);
    if (nextBB === undefined) continue;
    const path = `${basePath}/${bb.name}`;
    flagIfBlocked(bb, path, confirmed, blocked);
    walkBlockedBehaviours(
      bb.behaviours,
      nextBB.behaviours,
      `${path}/behaviours`,
      confirmed,
      blocked,
    );
    walkBlockedFlat<DesignedRule>(
      bb.rules,
      nextBB.rules,
      `${path}/rules`,
      confirmed,
      blocked,
    );
    walkBlockedFlat<DesignedScenario>(
      bb.scenarios,
      nextBB.scenarios,
      `${path}/scenarios`,
      confirmed,
      blocked,
    );
    walkBlockedFlat<DesignedQualityAttribute>(
      bb.qualityAttributes,
      nextBB.qualityAttributes,
      `${path}/qualityAttributes`,
      confirmed,
      blocked,
    );
  }
}

function walkBlockedBehaviours(
  prev: ChangeSet<DesignedBehaviour> | undefined,
  next: ChangeSet<DesignedBehaviour> | undefined,
  basePath: string,
  confirmed: ReadonlySet<string>,
  blocked: string[],
): void {
  if (prev === undefined || next === undefined) return;
  const nextByName = nameMap(next.added);
  for (const bh of prev.added) {
    const nextBH = nextByName.get(bh.name);
    if (nextBH === undefined) continue;
    const path = `${basePath}/${bh.name}`;
    flagIfBlocked(bh, path, confirmed, blocked);
    walkBlockedFlat<DesignedRule>(
      bh.rules,
      nextBH.rules,
      `${path}/rules`,
      confirmed,
      blocked,
    );
    walkBlockedFlat<DesignedScenario>(
      bh.scenarios,
      nextBH.scenarios,
      `${path}/scenarios`,
      confirmed,
      blocked,
    );
    walkBlockedFlat<DesignedQualityAttribute>(
      bh.qualityAttributes,
      nextBH.qualityAttributes,
      `${path}/qualityAttributes`,
      confirmed,
      blocked,
    );
  }
}

function walkBlockedFlat<T extends ElementWithFlag>(
  prev: ChangeSet<T> | undefined,
  next: ChangeSet<T> | undefined,
  basePath: string,
  confirmed: ReadonlySet<string>,
  blocked: string[],
): void {
  if (prev === undefined || next === undefined) return;
  const nextByName = nameMap(next.added);
  for (const item of prev.added) {
    if (!nextByName.has(item.name)) continue;
    flagIfBlocked(item, `${basePath}/${item.name}`, confirmed, blocked);
  }
}

function flagIfBlocked(
  prevElement: ElementWithFlag,
  path: string,
  confirmed: ReadonlySet<string>,
  blocked: string[],
): void {
  if (prevElement.edited_by_user !== true) return;
  if (confirmed.has(path)) return;
  blocked.push(path);
}

function nameMap<T extends { name: string }>(items: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) map.set(item.name, item);
  return map;
}

function stripDocFlags(doc: DesignDoc): DesignDoc {
  return {
    ...doc,
    boundedContexts: stripBCChangeSetFlags(doc.boundedContexts),
  };
}

function stripBCChangeSetFlags(
  cs: ChangeSet<DesignedBoundedContext> | undefined,
): ChangeSet<DesignedBoundedContext> | undefined {
  if (cs === undefined) return undefined;
  return {
    added: cs.added.map(stripBoundedContextFlags),
    modified: cs.modified.map(stripBoundedContextFlags),
    removed: [...cs.removed],
  };
}

function stripBoundedContextFlags(
  bc: DesignedBoundedContext,
): DesignedBoundedContext {
  return {
    ...stripFlag(bc),
    modules: stripModuleChangeSetFlags(bc.modules),
    buildingBlocks: stripBuildingBlockChangeSetFlags(bc.buildingBlocks),
    qualityAttributes: stripFlatChangeSetFlags(bc.qualityAttributes),
  };
}

function stripModuleChangeSetFlags(
  cs: ChangeSet<DesignedDomainModule> | undefined,
): ChangeSet<DesignedDomainModule> | undefined {
  if (cs === undefined) return undefined;
  return {
    added: cs.added.map(stripModuleFlags),
    modified: cs.modified.map(stripModuleFlags),
    removed: [...cs.removed],
  };
}

function stripModuleFlags(mod: DesignedDomainModule): DesignedDomainModule {
  return {
    ...stripFlag(mod),
    buildingBlocks: stripBuildingBlockChangeSetFlags(mod.buildingBlocks),
    qualityAttributes: stripFlatChangeSetFlags(mod.qualityAttributes),
  };
}

function stripBuildingBlockChangeSetFlags(
  cs: ChangeSet<DesignedBuildingBlock> | undefined,
): ChangeSet<DesignedBuildingBlock> | undefined {
  if (cs === undefined) return undefined;
  return {
    added: cs.added.map(stripBuildingBlockFlags),
    modified: cs.modified.map(stripBuildingBlockFlags),
    removed: [...cs.removed],
  };
}

function stripBuildingBlockFlags(
  bb: DesignedBuildingBlock,
): DesignedBuildingBlock {
  return {
    ...stripFlag(bb),
    behaviours: stripBehaviourChangeSetFlags(bb.behaviours),
    rules: stripFlatChangeSetFlags(bb.rules),
    scenarios: stripFlatChangeSetFlags(bb.scenarios),
    qualityAttributes: stripFlatChangeSetFlags(bb.qualityAttributes),
  };
}

function stripBehaviourChangeSetFlags(
  cs: ChangeSet<DesignedBehaviour> | undefined,
): ChangeSet<DesignedBehaviour> | undefined {
  if (cs === undefined) return undefined;
  return {
    added: cs.added.map(stripBehaviourFlags),
    modified: cs.modified.map(stripBehaviourFlags),
    removed: [...cs.removed],
  };
}

function stripBehaviourFlags(bh: DesignedBehaviour): DesignedBehaviour {
  return {
    ...stripFlag(bh),
    rules: stripFlatChangeSetFlags(bh.rules),
    scenarios: stripFlatChangeSetFlags(bh.scenarios),
    qualityAttributes: stripFlatChangeSetFlags(bh.qualityAttributes),
  };
}

function stripFlatChangeSetFlags<T extends { edited_by_user?: boolean }>(
  cs: ChangeSet<T> | undefined,
): ChangeSet<T> | undefined {
  if (cs === undefined) return undefined;
  return {
    added: cs.added.map(stripFlag),
    modified: cs.modified.map(stripFlag),
    removed: [...cs.removed],
  };
}

function stripFlag<T extends { edited_by_user?: boolean }>(item: T): T {
  if (item.edited_by_user === undefined) return item;
  const { edited_by_user: _flag, ...rest } = item;
  return rest as T;
}
