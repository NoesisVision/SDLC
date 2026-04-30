import { existsSync, readFileSync, unlinkSync } from "fs";
import { resolve as resolvePath } from "path";
import {
  DesignDocSchema,
  type DesignDoc,
  type DesignedBehaviour,
  type DesignedBoundedContext,
  type DesignedBuildingBlock,
  type DesignedDomainModule,
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

export interface SplitDesignDocOptions {
  projectDir: string;
  confirmedEdits?: ReadonlySet<string>;
  inputPath?: string;
}

export interface SplitDesignDocResult {
  canonical_path: string;
}

export class UserEditConflictError extends Error {
  constructor(public readonly blockedPaths: string[]) {
    super(
      `Save blocked: ${blockedPaths.length} user-edited element(s) targeted without confirmation: ${blockedPaths.join(", ")}`,
    );
    this.name = "UserEditConflictError";
  }
}

export function splitDesignDoc(
  designDoc: DesignDoc,
  options: SplitDesignDocOptions,
): SplitDesignDocResult {
  ensureNoesisLayout(options.projectDir);
  const target = designDocCanonicalPath(
    options.projectDir,
    designDoc.id,
    designDoc.name,
  );
  const inputPath =
    options.inputPath !== undefined ? resolvePath(options.inputPath) : null;
  const prevPath = findDesignDocFileById(
    options.projectDir,
    designDoc.id,
    inputPath !== null ? new Set([inputPath]) : undefined,
  );
  const prev =
    prevPath !== null && existsSync(prevPath) ? loadIfExists(prevPath) : null;

  const confirmed = options.confirmedEdits ?? new Set<string>();
  const blocked = collectBlockedEdits(prev, designDoc, confirmed);
  if (blocked.length > 0) {
    throw new UserEditConflictError(blocked);
  }

  const merged = mergeWithUserEdits(prev, designDoc, confirmed);
  writeSidecar(target, merged, DesignDocSchema);

  if (prevPath !== null && prevPath !== target && existsSync(prevPath)) {
    try {
      unlinkSync(prevPath);
    } catch {
      // best-effort
    }
  }
  if (
    inputPath !== null &&
    inputPath !== target &&
    inputPath !== prevPath &&
    existsSync(inputPath)
  ) {
    try {
      unlinkSync(inputPath);
    } catch {
      // best-effort
    }
  }

  return { canonical_path: target };
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

function collectBlockedEdits(
  prev: DesignDoc | null,
  next: DesignDoc,
  confirmed: ReadonlySet<string>,
): string[] {
  if (prev === null) return [];
  const blocked: string[] = [];
  walkBlockedFlat(prev.actors, next.actors, "actors", confirmed, blocked);
  walkBlockedFlat(
    prev.qualityAttributes,
    next.qualityAttributes,
    "qualityAttributes",
    confirmed,
    blocked,
  );
  walkBlockedBoundedContexts(
    prev.boundedContexts,
    next.boundedContexts,
    "boundedContexts",
    confirmed,
    blocked,
  );
  return blocked;
}

function walkBlockedFlat<T extends ElementWithFlag>(
  prev: ChangeSet<T> | undefined,
  next: ChangeSet<T> | undefined,
  basePath: string,
  confirmed: ReadonlySet<string>,
  blocked: string[],
): void {
  if (next === undefined) return;
  const prevByName = nameMap(prev?.added ?? []);
  for (const name of next.removed ?? []) {
    flagIfBlocked(prevByName.get(name), `${basePath}/${name}`, confirmed, blocked);
  }
  for (const item of next.modified ?? []) {
    flagIfBlocked(prevByName.get(item.name), `${basePath}/${item.name}`, confirmed, blocked);
  }
}

function walkBlockedBoundedContexts(
  prev: ChangeSet<DesignedBoundedContext> | undefined,
  next: ChangeSet<DesignedBoundedContext> | undefined,
  basePath: string,
  confirmed: ReadonlySet<string>,
  blocked: string[],
): void {
  if (next === undefined) return;
  const prevByName = nameMap(prev?.added ?? []);
  for (const name of next.removed ?? []) {
    flagIfBlocked(prevByName.get(name), `${basePath}/${name}`, confirmed, blocked);
  }
  for (const bc of next.modified ?? []) {
    const path = `${basePath}/${bc.name}`;
    flagIfBlocked(prevByName.get(bc.name), path, confirmed, blocked);
    const prevBC = prevByName.get(bc.name);
    if (prevBC !== undefined) walkBlockedBCChildren(prevBC, bc, path, confirmed, blocked);
  }
}

function walkBlockedBCChildren(
  prev: DesignedBoundedContext,
  next: DesignedBoundedContext,
  basePath: string,
  confirmed: ReadonlySet<string>,
  blocked: string[],
): void {
  walkBlockedModules(prev.modules, next.modules, `${basePath}/modules`, confirmed, blocked);
  walkBlockedBuildingBlocks(
    prev.buildingBlocks,
    next.buildingBlocks,
    `${basePath}/buildingBlocks`,
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
  if (next === undefined) return;
  const prevByName = nameMap(prev?.added ?? []);
  for (const name of next.removed ?? []) {
    flagIfBlocked(prevByName.get(name), `${basePath}/${name}`, confirmed, blocked);
  }
  for (const m of next.modified ?? []) {
    const path = `${basePath}/${m.name}`;
    flagIfBlocked(prevByName.get(m.name), path, confirmed, blocked);
    const prevM = prevByName.get(m.name);
    if (prevM !== undefined) {
      walkBlockedBuildingBlocks(
        prevM.buildingBlocks,
        m.buildingBlocks,
        `${path}/buildingBlocks`,
        confirmed,
        blocked,
      );
    }
  }
}

function walkBlockedBuildingBlocks(
  prev: ChangeSet<DesignedBuildingBlock> | undefined,
  next: ChangeSet<DesignedBuildingBlock> | undefined,
  basePath: string,
  confirmed: ReadonlySet<string>,
  blocked: string[],
): void {
  if (next === undefined) return;
  const prevByName = nameMap(prev?.added ?? []);
  for (const name of next.removed ?? []) {
    flagIfBlocked(prevByName.get(name), `${basePath}/${name}`, confirmed, blocked);
  }
  for (const bb of next.modified ?? []) {
    const path = `${basePath}/${bb.name}`;
    flagIfBlocked(prevByName.get(bb.name), path, confirmed, blocked);
    const prevBB = prevByName.get(bb.name);
    if (prevBB !== undefined) walkBlockedBBChildren(prevBB, bb, path, confirmed, blocked);
  }
}

function walkBlockedBBChildren(
  prev: DesignedBuildingBlock,
  next: DesignedBuildingBlock,
  basePath: string,
  confirmed: ReadonlySet<string>,
  blocked: string[],
): void {
  walkBlockedBehaviours(prev.behaviours, next.behaviours, `${basePath}/behaviours`, confirmed, blocked);
  walkBlockedFlat(prev.rules, next.rules, `${basePath}/rules`, confirmed, blocked);
  walkBlockedFlat(prev.scenarios, next.scenarios, `${basePath}/scenarios`, confirmed, blocked);
}

function walkBlockedBehaviours(
  prev: ChangeSet<DesignedBehaviour> | undefined,
  next: ChangeSet<DesignedBehaviour> | undefined,
  basePath: string,
  confirmed: ReadonlySet<string>,
  blocked: string[],
): void {
  if (next === undefined) return;
  const prevByName = nameMap(prev?.added ?? []);
  for (const name of next.removed ?? []) {
    flagIfBlocked(prevByName.get(name), `${basePath}/${name}`, confirmed, blocked);
  }
  for (const bh of next.modified ?? []) {
    const path = `${basePath}/${bh.name}`;
    flagIfBlocked(prevByName.get(bh.name), path, confirmed, blocked);
    const prevBH = prevByName.get(bh.name);
    if (prevBH !== undefined) {
      walkBlockedFlat(prevBH.rules, bh.rules, `${path}/rules`, confirmed, blocked);
      walkBlockedFlat(prevBH.scenarios, bh.scenarios, `${path}/scenarios`, confirmed, blocked);
    }
  }
}

function flagIfBlocked(
  prevElement: ElementWithFlag | undefined,
  path: string,
  confirmed: ReadonlySet<string>,
  blocked: string[],
): void {
  if (prevElement === undefined) return;
  if (prevElement.edited_by_user !== true) return;
  if (confirmed.has(path)) return;
  blocked.push(path);
}

function nameMap<T extends { name: string }>(items: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) map.set(item.name, item);
  return map;
}

function mergeWithUserEdits(
  prev: DesignDoc | null,
  next: DesignDoc,
  confirmed: ReadonlySet<string>,
): DesignDoc {
  if (prev === null) return next;
  return {
    ...next,
    actors: mergeFlatChangeSet(prev.actors, next.actors, "actors", confirmed),
    qualityAttributes: mergeFlatChangeSet(
      prev.qualityAttributes,
      next.qualityAttributes,
      "qualityAttributes",
      confirmed,
    ),
    boundedContexts: mergeBoundedContexts(
      prev.boundedContexts,
      next.boundedContexts,
      "boundedContexts",
      confirmed,
    ),
  };
}

function mergeFlatChangeSet<T extends ElementWithFlag>(
  prev: ChangeSet<T> | undefined,
  next: ChangeSet<T> | undefined,
  basePath: string,
  confirmed: ReadonlySet<string>,
): ChangeSet<T> | undefined {
  if (next === undefined) return prev;
  const prevByName = nameMap(prev?.added ?? []);
  return {
    added: (next.added ?? []).map((item) => {
      const prevItem = prevByName.get(item.name);
      const path = `${basePath}/${item.name}`;
      return preserveOrTake(prevItem, item, path, confirmed);
    }),
    modified: (next.modified ?? []).map(stripFlag),
    removed: [...(next.removed ?? [])],
  };
}

function preserveOrTake<T extends ElementWithFlag>(
  prevItem: T | undefined,
  nextItem: T,
  path: string,
  confirmed: ReadonlySet<string>,
): T {
  if (
    prevItem !== undefined &&
    prevItem.edited_by_user === true &&
    !confirmed.has(path)
  ) {
    return prevItem;
  }
  return stripFlag(nextItem);
}

function stripFlag<T extends { edited_by_user?: boolean }>(item: T): T {
  if (item.edited_by_user === undefined) return item;
  const { edited_by_user: _flag, ...rest } = item;
  return rest as T;
}

function mergeBoundedContexts(
  prev: ChangeSet<DesignedBoundedContext> | undefined,
  next: ChangeSet<DesignedBoundedContext> | undefined,
  basePath: string,
  confirmed: ReadonlySet<string>,
): ChangeSet<DesignedBoundedContext> | undefined {
  if (next === undefined) return prev;
  const prevByName = nameMap(prev?.added ?? []);
  return {
    added: (next.added ?? []).map((bc) => {
      const prevBC = prevByName.get(bc.name);
      const path = `${basePath}/${bc.name}`;
      if (prevBC === undefined) return stripFlag(bc);
      return mergeBoundedContext(prevBC, bc, path, confirmed);
    }),
    modified: (next.modified ?? []).map(stripFlag),
    removed: [...(next.removed ?? [])],
  };
}

function mergeBoundedContext(
  prev: DesignedBoundedContext,
  next: DesignedBoundedContext,
  path: string,
  confirmed: ReadonlySet<string>,
): DesignedBoundedContext {
  const keepPrev = prev.edited_by_user === true && !confirmed.has(path);
  const head = keepPrev ? prev : stripFlag(next);
  return {
    ...head,
    name: next.name,
    modules: mergeModuleChangeSet(
      prev.modules,
      next.modules,
      `${path}/modules`,
      confirmed,
    ),
    buildingBlocks: mergeBuildingBlockChangeSet(
      prev.buildingBlocks,
      next.buildingBlocks,
      `${path}/buildingBlocks`,
      confirmed,
    ),
  };
}

function mergeModuleChangeSet(
  prev: ChangeSet<DesignedDomainModule> | undefined,
  next: ChangeSet<DesignedDomainModule> | undefined,
  basePath: string,
  confirmed: ReadonlySet<string>,
): ChangeSet<DesignedDomainModule> | undefined {
  if (next === undefined) return prev;
  const prevByName = nameMap(prev?.added ?? []);
  return {
    added: (next.added ?? []).map((m) => {
      const prevM = prevByName.get(m.name);
      const path = `${basePath}/${m.name}`;
      if (prevM === undefined) return stripFlag(m);
      return mergeModule(prevM, m, path, confirmed);
    }),
    modified: (next.modified ?? []).map(stripFlag),
    removed: [...(next.removed ?? [])],
  };
}

function mergeModule(
  prev: DesignedDomainModule,
  next: DesignedDomainModule,
  path: string,
  confirmed: ReadonlySet<string>,
): DesignedDomainModule {
  const keepPrev = prev.edited_by_user === true && !confirmed.has(path);
  const head = keepPrev ? prev : stripFlag(next);
  return {
    ...head,
    name: next.name,
    buildingBlocks: mergeBuildingBlockChangeSet(
      prev.buildingBlocks,
      next.buildingBlocks,
      `${path}/buildingBlocks`,
      confirmed,
    ),
  };
}

function mergeBuildingBlockChangeSet(
  prev: ChangeSet<DesignedBuildingBlock> | undefined,
  next: ChangeSet<DesignedBuildingBlock> | undefined,
  basePath: string,
  confirmed: ReadonlySet<string>,
): ChangeSet<DesignedBuildingBlock> | undefined {
  if (next === undefined) return prev;
  const prevByName = nameMap(prev?.added ?? []);
  return {
    added: (next.added ?? []).map((bb) => {
      const prevBB = prevByName.get(bb.name);
      const path = `${basePath}/${bb.name}`;
      if (prevBB === undefined) return stripFlag(bb);
      return mergeBuildingBlock(prevBB, bb, path, confirmed);
    }),
    modified: (next.modified ?? []).map(stripFlag),
    removed: [...(next.removed ?? [])],
  };
}

function mergeBuildingBlock(
  prev: DesignedBuildingBlock,
  next: DesignedBuildingBlock,
  path: string,
  confirmed: ReadonlySet<string>,
): DesignedBuildingBlock {
  const keepPrev = prev.edited_by_user === true && !confirmed.has(path);
  const head = keepPrev ? prev : stripFlag(next);
  return {
    ...head,
    name: next.name,
    behaviours: mergeBehaviourChangeSet(
      prev.behaviours,
      next.behaviours,
      `${path}/behaviours`,
      confirmed,
    ),
    rules: mergeFlatChangeSet<DesignedRule>(
      prev.rules,
      next.rules,
      `${path}/rules`,
      confirmed,
    ),
    scenarios: mergeFlatChangeSet<DesignedScenario>(
      prev.scenarios,
      next.scenarios,
      `${path}/scenarios`,
      confirmed,
    ),
  };
}

function mergeBehaviourChangeSet(
  prev: ChangeSet<DesignedBehaviour> | undefined,
  next: ChangeSet<DesignedBehaviour> | undefined,
  basePath: string,
  confirmed: ReadonlySet<string>,
): ChangeSet<DesignedBehaviour> | undefined {
  if (next === undefined) return prev;
  const prevByName = nameMap(prev?.added ?? []);
  return {
    added: (next.added ?? []).map((bh) => {
      const prevBH = prevByName.get(bh.name);
      const path = `${basePath}/${bh.name}`;
      if (prevBH === undefined) return stripFlag(bh);
      return mergeBehaviour(prevBH, bh, path, confirmed);
    }),
    modified: (next.modified ?? []).map(stripFlag),
    removed: [...(next.removed ?? [])],
  };
}

function mergeBehaviour(
  prev: DesignedBehaviour,
  next: DesignedBehaviour,
  path: string,
  confirmed: ReadonlySet<string>,
): DesignedBehaviour {
  const keepPrev = prev.edited_by_user === true && !confirmed.has(path);
  const head = keepPrev ? prev : stripFlag(next);
  return {
    ...head,
    name: next.name,
    rules: mergeFlatChangeSet<DesignedRule>(
      prev.rules,
      next.rules,
      `${path}/rules`,
      confirmed,
    ),
    scenarios: mergeFlatChangeSet<DesignedScenario>(
      prev.scenarios,
      next.scenarios,
      `${path}/scenarios`,
      confirmed,
    ),
  };
}
