import type {
  DesignDoc,
  DesignedBoundedContext,
  DesignedBuildingBlock,
  DesignedDomainModule,
} from "../../../shared-contracts/design-doc.js";
import type {
  BoundedContextBranch,
  BuildingBlockBranch,
  DomainModelTree,
  ModuleBranch,
} from "../scanner/domain-model/domain-model.js";

export type ComparisonStatus = "Ok" | "Mismatch";

export interface ComparisonResult {
  status: ComparisonStatus;
  problems: string[];
}

export interface ComparisonInput {
  before: DomainModelTree;
  after: DomainModelTree;
  doc: DesignDoc;
}

interface BoundedContextSnapshot {
  name: string;
  modules: Map<string, ModuleSnapshot>;
  buildingBlocks: Map<string, BuildingBlockSnapshot>;
}

interface ModuleSnapshot {
  fullPath: string;
  buildingBlocks: Map<string, BuildingBlockSnapshot>;
}

interface BuildingBlockSnapshot {
  name: string;
  type: string;
  behaviors: Map<string, true>;
}

type ChangeOp = "added" | "removed" | "modified";

interface ChangeKey {
  level: "boundedContext" | "module" | "buildingBlock" | "behavior";
  op: ChangeOp;
  identifier: string;
}

export function compareImplementation(input: ComparisonInput): ComparisonResult {
  const before = indexTree(input.before);
  const after = indexTree(input.after);
  const expected = collectExpectedChanges(input.doc, before);
  const actual = collectActualChanges(before, after);

  const problems: string[] = [];
  problems.push(...findMissingChanges(expected, actual));
  problems.push(...findUnexpectedChanges(expected, actual));

  return { status: problems.length === 0 ? "Ok" : "Mismatch", problems };
}

function indexTree(tree: DomainModelTree): Map<string, BoundedContextSnapshot> {
  const result = new Map<string, BoundedContextSnapshot>();
  for (const bc of tree.boundedContexts) {
    result.set(bc.name, indexBoundedContext(bc));
  }
  return result;
}

function indexBoundedContext(bc: BoundedContextBranch<BuildingBlockBranch>): BoundedContextSnapshot {
  const modules = new Map<string, ModuleSnapshot>();
  for (const mod of flattenModules(bc.modules)) {
    modules.set(mod.fullPath, indexModule(mod));
  }
  return {
    name: bc.name,
    modules,
    buildingBlocks: indexBuildingBlocks(bc.buildingBlocks),
  };
}

function flattenModules(
  modules: ModuleBranch<BuildingBlockBranch>[],
): ModuleBranch<BuildingBlockBranch>[] {
  const out: ModuleBranch<BuildingBlockBranch>[] = [];
  for (const m of modules) {
    out.push(m);
    out.push(...flattenModules(m.modules));
  }
  return out;
}

function indexModule(mod: ModuleBranch<BuildingBlockBranch>): ModuleSnapshot {
  return {
    fullPath: mod.fullPath,
    buildingBlocks: indexBuildingBlocks(mod.buildingBlocks),
  };
}

function indexBuildingBlocks(blocks: BuildingBlockBranch[]): Map<string, BuildingBlockSnapshot> {
  const map = new Map<string, BuildingBlockSnapshot>();
  for (const bb of blocks) {
    map.set(bb.name, {
      name: bb.name,
      type: bb.type,
      behaviors: new Map(bb.behaviors.map((b) => [b.name, true as const])),
    });
  }
  return map;
}

function collectActualChanges(
  before: Map<string, BoundedContextSnapshot>,
  after: Map<string, BoundedContextSnapshot>,
): Map<string, ChangeKey> {
  const changes = new Map<string, ChangeKey>();

  for (const [bcName, beforeBc] of before) {
    const afterBc = after.get(bcName);
    if (afterBc === undefined) {
      addChange(changes, { level: "boundedContext", op: "removed", identifier: bcName });
      for (const change of changesForRemovedBoundedContext(beforeBc)) {
        addChange(changes, change);
      }
      continue;
    }
    diffWithinBoundedContext(beforeBc, afterBc, changes);
  }
  for (const [bcName, afterBc] of after) {
    if (before.has(bcName)) continue;
    addChange(changes, { level: "boundedContext", op: "added", identifier: bcName });
    for (const change of changesForAddedBoundedContext(afterBc)) {
      addChange(changes, change);
    }
  }
  return changes;
}

function diffWithinBoundedContext(
  before: BoundedContextSnapshot,
  after: BoundedContextSnapshot,
  out: Map<string, ChangeKey>,
): void {
  for (const [path, beforeMod] of before.modules) {
    const afterMod = after.modules.get(path);
    if (afterMod === undefined) {
      addChange(out, { level: "module", op: "removed", identifier: path });
      for (const change of changesForRemovedModule(beforeMod)) addChange(out, change);
      continue;
    }
    diffBuildingBlocks(path, beforeMod.buildingBlocks, afterMod.buildingBlocks, out);
  }
  for (const [path, afterMod] of after.modules) {
    if (before.modules.has(path)) continue;
    addChange(out, { level: "module", op: "added", identifier: path });
    for (const change of changesForAddedModule(afterMod)) addChange(out, change);
  }
  diffBuildingBlocks(before.name, before.buildingBlocks, after.buildingBlocks, out);
}

function diffBuildingBlocks(
  container: string,
  before: Map<string, BuildingBlockSnapshot>,
  after: Map<string, BuildingBlockSnapshot>,
  out: Map<string, ChangeKey>,
): void {
  for (const [name, beforeBb] of before) {
    const afterBb = after.get(name);
    if (afterBb === undefined) {
      addChange(out, {
        level: "buildingBlock",
        op: "removed",
        identifier: bbIdentifier(container, name),
      });
      for (const behaviorName of beforeBb.behaviors.keys()) {
        addChange(out, {
          level: "behavior",
          op: "removed",
          identifier: behaviorIdentifier(container, name, behaviorName),
        });
      }
      continue;
    }
    if (beforeBb.type !== afterBb.type) {
      addChange(out, {
        level: "buildingBlock",
        op: "modified",
        identifier: bbIdentifier(container, name),
      });
    }
    diffBehaviors(container, name, beforeBb.behaviors, afterBb.behaviors, out);
  }
  for (const [name, afterBb] of after) {
    if (before.has(name)) continue;
    addChange(out, {
      level: "buildingBlock",
      op: "added",
      identifier: bbIdentifier(container, name),
    });
    for (const behaviorName of afterBb.behaviors.keys()) {
      addChange(out, {
        level: "behavior",
        op: "added",
        identifier: behaviorIdentifier(container, name, behaviorName),
      });
    }
  }
}

function diffBehaviors(
  container: string,
  bbName: string,
  before: Map<string, true>,
  after: Map<string, true>,
  out: Map<string, ChangeKey>,
): void {
  for (const name of before.keys()) {
    if (!after.has(name)) {
      addChange(out, {
        level: "behavior",
        op: "removed",
        identifier: behaviorIdentifier(container, bbName, name),
      });
    }
  }
  for (const name of after.keys()) {
    if (!before.has(name)) {
      addChange(out, {
        level: "behavior",
        op: "added",
        identifier: behaviorIdentifier(container, bbName, name),
      });
    }
  }
}

function changesForAddedBoundedContext(bc: BoundedContextSnapshot): ChangeKey[] {
  const out: ChangeKey[] = [];
  for (const [path, mod] of bc.modules) {
    out.push({ level: "module", op: "added", identifier: path });
    for (const change of changesForAddedModule(mod)) out.push(change);
  }
  for (const [name, bb] of bc.buildingBlocks) {
    out.push({
      level: "buildingBlock",
      op: "added",
      identifier: bbIdentifier(bc.name, name),
    });
    for (const behaviorName of bb.behaviors.keys()) {
      out.push({
        level: "behavior",
        op: "added",
        identifier: behaviorIdentifier(bc.name, name, behaviorName),
      });
    }
  }
  return out;
}

function changesForAddedModule(mod: ModuleSnapshot): ChangeKey[] {
  const out: ChangeKey[] = [];
  for (const [name, bb] of mod.buildingBlocks) {
    out.push({
      level: "buildingBlock",
      op: "added",
      identifier: bbIdentifier(mod.fullPath, name),
    });
    for (const behaviorName of bb.behaviors.keys()) {
      out.push({
        level: "behavior",
        op: "added",
        identifier: behaviorIdentifier(mod.fullPath, name, behaviorName),
      });
    }
  }
  return out;
}

function changesForRemovedModule(mod: ModuleSnapshot): ChangeKey[] {
  const out: ChangeKey[] = [];
  for (const [name, bb] of mod.buildingBlocks) {
    out.push({
      level: "buildingBlock",
      op: "removed",
      identifier: bbIdentifier(mod.fullPath, name),
    });
    for (const behaviorName of bb.behaviors.keys()) {
      out.push({
        level: "behavior",
        op: "removed",
        identifier: behaviorIdentifier(mod.fullPath, name, behaviorName),
      });
    }
  }
  return out;
}

function collectExpectedChanges(
  doc: DesignDoc,
  before: Map<string, BoundedContextSnapshot>,
): Map<string, ChangeKey> {
  const out = new Map<string, ChangeKey>();
  for (const bc of doc.boundedContexts?.added ?? []) {
    addChange(out, { level: "boundedContext", op: "added", identifier: bc.name });
    expandBoundedContextChanges(bc, "added", out);
  }
  for (const bc of doc.boundedContexts?.modified ?? []) {
    addChange(out, { level: "boundedContext", op: "modified", identifier: bc.name });
    expandBoundedContextChanges(bc, "modified", out);
  }
  for (const name of doc.boundedContexts?.removed ?? []) {
    addChange(out, { level: "boundedContext", op: "removed", identifier: name });
    const beforeBc = before.get(name);
    if (beforeBc !== undefined) {
      for (const change of changesForRemovedBoundedContext(beforeBc)) {
        addChange(out, change);
      }
    }
  }
  return out;
}

function expandBoundedContextChanges(
  bc: DesignedBoundedContext,
  bcMode: "added" | "modified",
  out: Map<string, ChangeKey>,
): void {
  const bcContainer = bc.name;
  for (const m of bc.modules?.added ?? []) {
    const fullPath = `${bcContainer}.${m.name}`;
    addChange(out, { level: "module", op: "added", identifier: fullPath });
    expandModuleChanges(fullPath, m, "added", out);
  }
  for (const m of bc.modules?.modified ?? []) {
    const fullPath = `${bcContainer}.${m.name}`;
    addChange(out, { level: "module", op: "modified", identifier: fullPath });
    expandModuleChanges(fullPath, m, "modified", out);
  }
  if (bcMode === "modified") {
    for (const name of bc.modules?.removed ?? []) {
      const fullPath = `${bcContainer}.${name}`;
      addChange(out, { level: "module", op: "removed", identifier: fullPath });
    }
  }
  for (const bb of bc.buildingBlocks?.added ?? []) {
    addChange(out, {
      level: "buildingBlock",
      op: "added",
      identifier: bbIdentifier(bcContainer, bb.name),
    });
    expandBuildingBlockChanges(bcContainer, bb, "added", out);
  }
  for (const bb of bc.buildingBlocks?.modified ?? []) {
    addChange(out, {
      level: "buildingBlock",
      op: "modified",
      identifier: bbIdentifier(bcContainer, bb.name),
    });
    expandBuildingBlockChanges(bcContainer, bb, "modified", out);
  }
  if (bcMode === "modified") {
    for (const name of bc.buildingBlocks?.removed ?? []) {
      addChange(out, {
        level: "buildingBlock",
        op: "removed",
        identifier: bbIdentifier(bcContainer, name),
      });
    }
  }
}

function expandModuleChanges(
  fullPath: string,
  mod: DesignedDomainModule,
  modMode: "added" | "modified",
  out: Map<string, ChangeKey>,
): void {
  for (const bb of mod.buildingBlocks?.added ?? []) {
    addChange(out, {
      level: "buildingBlock",
      op: "added",
      identifier: bbIdentifier(fullPath, bb.name),
    });
    expandBuildingBlockChanges(fullPath, bb, "added", out);
  }
  for (const bb of mod.buildingBlocks?.modified ?? []) {
    addChange(out, {
      level: "buildingBlock",
      op: "modified",
      identifier: bbIdentifier(fullPath, bb.name),
    });
    expandBuildingBlockChanges(fullPath, bb, "modified", out);
  }
  if (modMode === "modified") {
    for (const name of mod.buildingBlocks?.removed ?? []) {
      addChange(out, {
        level: "buildingBlock",
        op: "removed",
        identifier: bbIdentifier(fullPath, name),
      });
    }
  }
}

function expandBuildingBlockChanges(
  container: string,
  bb: DesignedBuildingBlock,
  bbMode: "added" | "modified",
  out: Map<string, ChangeKey>,
): void {
  for (const bh of bb.behaviours?.added ?? []) {
    addChange(out, {
      level: "behavior",
      op: "added",
      identifier: behaviorIdentifier(container, bb.name, bh.name),
    });
  }
  for (const bh of bb.behaviours?.modified ?? []) {
    addChange(out, {
      level: "behavior",
      op: "modified",
      identifier: behaviorIdentifier(container, bb.name, bh.name),
    });
  }
  if (bbMode === "modified") {
    for (const name of bb.behaviours?.removed ?? []) {
      addChange(out, {
        level: "behavior",
        op: "removed",
        identifier: behaviorIdentifier(container, bb.name, name),
      });
    }
  }
}

function changesForRemovedBoundedContext(bc: BoundedContextSnapshot): ChangeKey[] {
  const out: ChangeKey[] = [];
  for (const [path, mod] of bc.modules) {
    out.push({ level: "module", op: "removed", identifier: path });
    out.push(...changesForRemovedModule(mod));
  }
  for (const [name, bb] of bc.buildingBlocks) {
    out.push({
      level: "buildingBlock",
      op: "removed",
      identifier: bbIdentifier(bc.name, name),
    });
    for (const behaviorName of bb.behaviors.keys()) {
      out.push({
        level: "behavior",
        op: "removed",
        identifier: behaviorIdentifier(bc.name, name, behaviorName),
      });
    }
  }
  return out;
}

function findMissingChanges(
  expected: Map<string, ChangeKey>,
  actual: Map<string, ChangeKey>,
): string[] {
  const out: string[] = [];
  for (const [key, change] of expected) {
    if (change.op === "modified") {
      if (!isPresentInActual(change, actual)) {
        out.push(`Expected ${describe(change)} is not present after implementation.`);
      }
      continue;
    }
    if (!actual.has(key)) {
      out.push(`Missing change: ${describe(change)} not introduced.`);
    }
  }
  return out;
}

function findUnexpectedChanges(
  expected: Map<string, ChangeKey>,
  actual: Map<string, ChangeKey>,
): string[] {
  const out: string[] = [];
  for (const [key, change] of actual) {
    if (expected.has(key)) continue;
    if (change.op === "modified" && expectedHasAnyOpFor(change, expected)) {
      continue;
    }
    out.push(`Unexpected change: ${describe(change)} is not in the design doc.`);
  }
  return out;
}

function isPresentInActual(change: ChangeKey, actual: Map<string, ChangeKey>): boolean {
  if (actual.has(keyOf({ ...change, op: "added" }))) return true;
  if (actual.has(keyOf({ ...change, op: "modified" }))) return true;
  if (actual.has(keyOf({ ...change, op: "removed" }))) return false;
  return true;
}

function expectedHasAnyOpFor(
  change: ChangeKey,
  expected: Map<string, ChangeKey>,
): boolean {
  return (
    expected.has(keyOf({ ...change, op: "added" })) ||
    expected.has(keyOf({ ...change, op: "modified" }))
  );
}

function addChange(out: Map<string, ChangeKey>, change: ChangeKey): void {
  out.set(keyOf(change), change);
}

function keyOf(change: ChangeKey): string {
  return `${change.level}:${change.op}:${change.identifier}`;
}

function bbIdentifier(container: string, name: string): string {
  return `${container}/${name}`;
}

function behaviorIdentifier(container: string, bbName: string, name: string): string {
  return `${container}/${bbName}/${name}`;
}

function describe(change: ChangeKey): string {
  switch (change.level) {
    case "boundedContext":
      return `${change.op} BoundedContext '${change.identifier}'`;
    case "module":
      return `${change.op} Module '${change.identifier}'`;
    case "buildingBlock":
      return `${change.op} BuildingBlock '${change.identifier}'`;
    case "behavior":
      return `${change.op} Behavior '${change.identifier}'`;
  }
}

