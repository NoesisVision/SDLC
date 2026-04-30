import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { resolve } from "path";
import {
  designDocCanonicalPath,
  findDesignDocFileById,
  readSidecar,
} from "../../../../shared-contracts/source-files.js";
import {
  DesignDocSchema,
  type DesignDoc,
  type DesignDocOverview,
  type DesignedActor,
  type DesignedBehaviour,
  type DesignedBoundedContext,
  type DesignedBuildingBlock,
  type DesignedDomainModule,
  type DesignedQualityAttribute,
  type DesignedRule,
  type DesignedScenario,
} from "../../../../shared-contracts/design-doc.js";
import { newUuid } from "../../../../shared-contracts/uuid.js";
import { PROJECT_DIR } from "../../config/config.module.js";
import {
  commitDesignDoc,
  UserEditConflictError,
} from "../../file-sync/design-doc-splitter.js";
import { FileLoaderService } from "../../file-sync/file-loader.service.js";
import type {
  DesignDocDetailData,
  DesignDocSourceData,
  DesignDocsPageData,
} from "../../ui-contracts/design-docs/design-docs-data.js";
import {
  DesignDocsRepository,
  type BoundedContextMapEntry,
  type ModelTarget,
} from "./design-docs.repository.js";

const RULE_DESCRIPTION_MIN = 80;
const BEHAVIOUR_DESCRIPTION_MIN = 400;
const BC_BUILDING_BLOCKS_FLAT_THRESHOLD = 20;
const BEHAVIOUR_USED_BB_DIAGRAM_THRESHOLD = 3;

export interface SaveDesignDocResult {
  status: "Ok";
  design_doc_id: string;
  canonical_path: string;
  warnings: string[];
}

@Injectable()
export class DesignDocsService implements OnModuleInit {
  private readonly logger = new Logger(DesignDocsService.name);

  constructor(
    private readonly repository: DesignDocsRepository,
    private readonly fileLoader: FileLoaderService,
    @Inject(PROJECT_DIR) private readonly projectDir: string
  ) {}

  async onModuleInit(): Promise<void> {
    await this.repository.initSchema();
  }

  async deleteDesignDoc(designDocId: string): Promise<{ id: string }> {
    await this.repository.deleteDesignDoc(designDocId);
    return { id: designDocId };
  }

  async getDesignDocDetail(designDocId: string): Promise<DesignDocDetailData> {
    const overview = await this.findOverview(designDocId);
    if (overview === null) {
      throw new Error(`DesignDoc not found: ${designDocId}`);
    }
    const source = await this.repository.readDesignDocSource(designDocId);
    if (source === null) {
      throw new Error(`DesignDoc source missing: ${designDocId}`);
    }
    return {
      id: overview.id,
      name: overview.name,
      description: overview.description,
      date: overview.date,
      source: source as unknown as DesignDocSourceData,
    };
  }

  async getDesignDocsPage(): Promise<DesignDocsPageData> {
    const overviews = await this.repository.listDesignDocs();
    const docs = overviews
      .map((o) => ({
        id: o.id,
        date: o.date,
        title: o.name,
        description: o.description,
        edited_by_user: o.edited_by_user ?? false,
      }))
      .sort(byDateDesc);
    return { docs };
  }

  async listDesignDocs(): Promise<DesignDocOverview[]> {
    return this.repository.listDesignDocs();
  }

  async readDesignDoc(designDocId: string): Promise<DesignDoc | null> {
    const fromDb = await this.repository.readDesignDoc(designDocId);
    if (fromDb === null) return null;
    const onDisk = readDesignDocFromDisk(this.projectDir, designDocId);
    if (onDisk !== null) overlayEditedFlags(fromDb, onDisk);
    return fromDb;
  }

  async readBoundedContextMap(): Promise<BoundedContextMapEntry[]> {
    return this.repository.readBoundedContextMap();
  }

  async readModelForTargets(targets: ModelTarget[]): Promise<DesignedBoundedContext[]> {
    return this.repository.readModelForTargets(targets);
  }

  async updateDesignDocElement(
    designDocId: string,
    path: ElementPathSegment[],
    fields: { name?: string; description?: string }
  ): Promise<{ ok: true }> {
    if (path.length === 0) {
      throw new Error("Element path must not be empty");
    }
    const source = await this.repository.readDesignDocSource(designDocId);
    if (source === null) {
      throw new Error(`DesignDoc not found or has no source: ${designDocId}`);
    }
    const target = locateElement(source, path);
    if (target === null) {
      throw new Error(`Element not found at path: ${describePath(path)}`);
    }
    const oldName = target.element.name;
    let renamed = false;
    if (fields.name !== undefined) {
      const trimmed = fields.name.trim();
      if (trimmed === "") throw new Error("Element name must not be empty");
      if (trimmed !== oldName) {
        target.element.name = trimmed;
        renamed = true;
      }
    }
    if (fields.description !== undefined && "description" in target.element) {
      (target.element as Record<string, unknown>).description = fields.description;
    }
    const overview = await this.findOverview(designDocId);
    const date = overview === null || overview.date === "" ? todayDate() : overview.date;
    if (renamed) {
      await this.repository.deleteDesignDoc(designDocId);
      await this.repository.applyDesignDoc(source, date);
    } else {
      await this.repository.applyDesignDoc(source, date);
    }
    this.logger.log(`Updated DesignDoc ${designDocId} element ${describePath(path)}`);
    return { ok: true };
  }

  async prepareDesignDocPath(
    name: string,
    id: string | null,
  ): Promise<{ id: string; canonical_path: string }> {
    const finalId = id ?? newUuid();
    return {
      id: finalId,
      canonical_path: designDocCanonicalPath(this.projectDir, finalId, name),
    };
  }

  async saveDesignDocFromFile(
    path: string,
    confirmedEdits: string[] = [],
  ): Promise<SaveDesignDocResult> {
    const doc = await this.readDesignDocFile(path);
    this.assertCanonicalPath(path, doc);
    return this.persist(doc, confirmedEdits);
  }

  private assertCanonicalPath(path: string, doc: DesignDoc): void {
    const expected = designDocCanonicalPath(this.projectDir, doc.id, doc.name);
    const resolved = resolve(path);
    if (resolved !== expected) {
      throw new Error(
        `DesignDoc path must be the canonical filename for this id+name. ` +
          `Expected: ${expected}, got: ${resolved}. ` +
          `Call prepare_design_doc_path to compute the canonical path before writing.`,
      );
    }
  }

  async saveDesignDoc(
    doc: DesignDoc,
    date: string,
    confirmedEdits: string[] = [],
  ): Promise<SaveDesignDocResult> {
    return this.persist(doc, confirmedEdits, date);
  }

  private async persist(
    doc: DesignDoc,
    confirmedEdits: string[],
    date: string = todayDate(),
  ): Promise<SaveDesignDocResult> {
    const { errors, warnings } = validateDesignDocQuality(doc);
    if (errors.length > 0) {
      throw new Error(formatQualityErrors(errors));
    }
    let commit;
    try {
      commit = commitDesignDoc(doc, {
        projectDir: this.projectDir,
        confirmedEdits: new Set(confirmedEdits),
      });
    } catch (err) {
      if (err instanceof UserEditConflictError) {
        throw new Error(
          `${err.message}\nPass these paths in 'confirmed_edits' after explicit user approval, or drop the changes.`,
        );
      }
      throw err;
    }
    await this.repository.applyDesignDoc(doc, date);
    await this.fileLoader.registerWritten(commit.canonical_path);
    this.logger.log(
      `Saved DesignDoc ${doc.id} (${doc.name}); canonical at ${commit.canonical_path}`,
    );
    return {
      status: "Ok",
      design_doc_id: doc.id,
      canonical_path: commit.canonical_path,
      warnings,
    };
  }

  private async findOverview(designDocId: string): Promise<DesignDocOverview | null> {
    const overviews = await this.repository.listDesignDocs();
    return overviews.find((o) => o.id === designDocId) ?? null;
  }

  private async readDesignDocFile(path: string): Promise<DesignDoc> {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    return DesignDocSchema.parse(parsed);
  }
}

function byDateDesc(a: { date: string }, b: { date: string }): number {
  if (a.date === b.date) return 0;
  if (a.date === "") return 1;
  if (b.date === "") return -1;
  return a.date < b.date ? 1 : -1;
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function readDesignDocFromDisk(
  projectDir: string,
  designDocId: string,
): DesignDoc | null {
  const path = findDesignDocFileById(projectDir, designDocId);
  if (path === null || !existsSync(path)) return null;
  try {
    return readSidecar(path, DesignDocSchema);
  } catch {
    return null;
  }
}

function overlayEditedFlags(target: DesignDoc, source: DesignDoc): void {
  overlayFlatList(target.actors?.added ?? [], source.actors?.added ?? []);
  overlayFlatList(
    target.qualityAttributes?.added ?? [],
    source.qualityAttributes?.added ?? [],
  );
  overlayBoundedContexts(
    target.boundedContexts?.added ?? [],
    source.boundedContexts?.added ?? [],
  );
}

function overlayFlatList<T extends { name: string; edited_by_user?: boolean }>(
  target: T[],
  source: T[],
): void {
  const sourceByName = new Map(source.map((s) => [s.name, s]));
  for (const t of target) {
    const s = sourceByName.get(t.name);
    if (s?.edited_by_user === true) t.edited_by_user = true;
  }
}

function overlayBoundedContexts(
  target: DesignedBoundedContext[],
  source: DesignedBoundedContext[],
): void {
  const sourceByName = new Map(source.map((s) => [s.name, s]));
  for (const t of target) {
    const s = sourceByName.get(t.name);
    if (s === undefined) continue;
    if (s.edited_by_user === true) t.edited_by_user = true;
    overlayModules(t.modules?.added ?? [], s.modules?.added ?? []);
    overlayBuildingBlocks(
      t.buildingBlocks?.added ?? [],
      s.buildingBlocks?.added ?? [],
    );
  }
}

function overlayModules(
  target: DesignedDomainModule[],
  source: DesignedDomainModule[],
): void {
  const sourceByName = new Map(source.map((s) => [s.name, s]));
  for (const t of target) {
    const s = sourceByName.get(t.name);
    if (s === undefined) continue;
    if (s.edited_by_user === true) t.edited_by_user = true;
    overlayBuildingBlocks(
      t.buildingBlocks?.added ?? [],
      s.buildingBlocks?.added ?? [],
    );
  }
}

function overlayBuildingBlocks(
  target: DesignedBuildingBlock[],
  source: DesignedBuildingBlock[],
): void {
  const sourceByName = new Map(source.map((s) => [s.name, s]));
  for (const t of target) {
    const s = sourceByName.get(t.name);
    if (s === undefined) continue;
    if (s.edited_by_user === true) t.edited_by_user = true;
    overlayBehaviours(t.behaviours?.added ?? [], s.behaviours?.added ?? []);
    overlayFlatList(t.rules?.added ?? [], s.rules?.added ?? []);
    overlayFlatList(t.scenarios?.added ?? [], s.scenarios?.added ?? []);
  }
}

function overlayBehaviours(
  target: DesignedBehaviour[],
  source: DesignedBehaviour[],
): void {
  const sourceByName = new Map(source.map((s) => [s.name, s]));
  for (const t of target) {
    const s = sourceByName.get(t.name);
    if (s === undefined) continue;
    if (s.edited_by_user === true) t.edited_by_user = true;
    overlayFlatList(t.rules?.added ?? [], s.rules?.added ?? []);
    overlayFlatList(t.scenarios?.added ?? [], s.scenarios?.added ?? []);
  }
}

interface QualityReport {
  errors: string[];
  warnings: string[];
}

export function validateDesignDocQuality(doc: DesignDoc): QualityReport {
  const report: QualityReport = { errors: [], warnings: [] };
  for (const bc of doc.boundedContexts?.added ?? []) {
    validateBoundedContext(bc, "added", report);
  }
  for (const bc of doc.boundedContexts?.modified ?? []) {
    validateBoundedContext(bc, "modified", report);
  }
  validateRemovedNotReferenced(doc, report);
  validateImplementsResolution(doc, report);
  return report;
}

function validateBoundedContext(
  bc: DesignedBoundedContext,
  mode: "added" | "modified",
  report: QualityReport
): void {
  if (mode === "added") {
    const directBlockCount = bc.buildingBlocks?.added.length ?? 0;
    const moduleCount = bc.modules?.added.length ?? 0;
    if (directBlockCount > BC_BUILDING_BLOCKS_FLAT_THRESHOLD && moduleCount === 0) {
      report.warnings.push(
        `Bounded Context '${bc.name}' has ${directBlockCount} building blocks and no modules — ` +
          `consider grouping them into 3–7 modules along the natural cohesion axes.`
      );
    }
  }
  for (const m of bc.modules?.added ?? []) {
    validateModule(bc.name, m, "added", report);
  }
  for (const m of bc.modules?.modified ?? []) {
    validateModule(bc.name, m, "modified", report);
  }
  for (const bb of bc.buildingBlocks?.added ?? []) {
    validateBuildingBlock(bc.name, null, bb, "added", report);
  }
  for (const bb of bc.buildingBlocks?.modified ?? []) {
    validateBuildingBlock(bc.name, null, bb, "modified", report);
  }
}

function validateModule(
  bcName: string,
  m: DesignedDomainModule,
  _mode: "added" | "modified",
  report: QualityReport
): void {
  for (const bb of m.buildingBlocks?.added ?? []) {
    validateBuildingBlock(bcName, m.name, bb, "added", report);
  }
  for (const bb of m.buildingBlocks?.modified ?? []) {
    validateBuildingBlock(bcName, m.name, bb, "modified", report);
  }
}

function validateBuildingBlock(
  bcName: string,
  moduleName: string | null,
  bb: DesignedBuildingBlock,
  _mode: "added" | "modified",
  report: QualityReport
): void {
  const blockPath = formatBlockPath(bcName, moduleName, bb.name);
  const ruleNamesAtBB = new Set<string>();
  for (const r of bb.rules?.added ?? []) {
    validateRule(blockPath, r, "added", report);
    ruleNamesAtBB.add(r.name);
  }
  for (const r of bb.rules?.modified ?? []) {
    validateRule(blockPath, r, "modified", report);
    ruleNamesAtBB.add(r.name);
  }
  for (const bh of bb.behaviours?.added ?? []) {
    validateBehaviour(blockPath, bh, "added", report);
    flagDualLevelRules(blockPath, bb.name, bh, ruleNamesAtBB, report);
  }
  for (const bh of bb.behaviours?.modified ?? []) {
    validateBehaviour(blockPath, bh, "modified", report);
    flagDualLevelRules(blockPath, bb.name, bh, ruleNamesAtBB, report);
  }
}

function flagDualLevelRules(
  blockPath: string,
  bbName: string,
  bh: DesignedBehaviour,
  ruleNamesAtBB: Set<string>,
  report: QualityReport
): void {
  const behaviourRuleNames: string[] = [];
  for (const r of bh.rules?.added ?? []) behaviourRuleNames.push(r.name);
  for (const r of bh.rules?.modified ?? []) behaviourRuleNames.push(r.name);
  for (const ruleName of behaviourRuleNames) {
    if (ruleNamesAtBB.has(ruleName)) {
      report.errors.push(
        `Rule '${ruleName}' is attached at both Building Block '${bbName}' and Behaviour '${bh.name}' (path '${blockPath}.${bh.name}') — attach at exactly one level.`
      );
    }
  }
}

function validateBehaviour(
  blockPath: string,
  bh: DesignedBehaviour,
  mode: "added" | "modified",
  report: QualityReport
): void {
  const behaviourPath = `${blockPath}.${bh.name}`;
  if (mode === "added") {
    if (bh.description === null || bh.description.length === 0) {
      report.errors.push(
        `Behaviour '${behaviourPath}' is missing description ` +
          `(required ≥${BEHAVIOUR_DESCRIPTION_MIN} chars for added behaviours).`
      );
    } else if (bh.description.length < BEHAVIOUR_DESCRIPTION_MIN) {
      report.errors.push(
        `Behaviour '${behaviourPath}' description is ${bh.description.length} chars ` +
          `(need ≥${BEHAVIOUR_DESCRIPTION_MIN}). Cover Input / Validation / numbered Steps / Output.`
      );
    } else if (shouldHaveDiagram(bh) && !bh.description.includes("```mermaid")) {
      report.warnings.push(
        `Behaviour '${behaviourPath}' is an application_service or uses ≥${BEHAVIOUR_USED_BB_DIAGRAM_THRESHOLD} ` +
          `building blocks — embed a \`\`\`mermaid sequence diagram in description for clarity.`
      );
    }
  } else if (
    bh.description !== null &&
    bh.description.length > 0 &&
    bh.description.length < BEHAVIOUR_DESCRIPTION_MIN
  ) {
    report.errors.push(
      `Behaviour '${behaviourPath}' modified description is ${bh.description.length} chars ` +
        `(need ≥${BEHAVIOUR_DESCRIPTION_MIN}).`
    );
  }
  for (const r of bh.rules?.added ?? []) {
    validateRule(behaviourPath, r, "added", report);
  }
  for (const r of bh.rules?.modified ?? []) {
    validateRule(behaviourPath, r, "modified", report);
  }
}

function validateRule(
  parentPath: string,
  r: DesignedRule,
  mode: "added" | "modified",
  report: QualityReport
): void {
  const rulePath = `${parentPath}#${r.name}`;
  const tautological =
    r.description !== null && r.description.length > 0 && isTautology(r.name, r.description);
  if (mode === "added") {
    if (r.description === null || r.description.length === 0) {
      report.errors.push(
        `Rule '${rulePath}' is missing description ` +
          `(required ≥${RULE_DESCRIPTION_MIN} chars for added rules).`
      );
    } else if (r.description.length < RULE_DESCRIPTION_MIN) {
      report.errors.push(
        `Rule '${rulePath}' description is ${r.description.length} chars ` +
          `(need ≥${RULE_DESCRIPTION_MIN}). Cover Trigger / Pre / Algorithm / Post / Edge cases.`
      );
    } else if (tautological) {
      report.errors.push(
        `Rule '${rulePath}' description is a tautology — it paraphrases the rule name without an algorithm.`
      );
    }
  } else if (
    r.description !== null &&
    r.description.length > 0 &&
    r.description.length < RULE_DESCRIPTION_MIN
  ) {
    report.errors.push(
      `Rule '${rulePath}' modified description is ${r.description.length} chars ` +
        `(need ≥${RULE_DESCRIPTION_MIN}).`
    );
  }
}

function shouldHaveDiagram(bh: DesignedBehaviour): boolean {
  if (bh.type === undefined || bh.type === null) return false;
  // type is the Behaviour message kind; the heuristic uses building-block coupling.
  const usedCount = bh.usedBuildingBlocks?.added.length ?? 0;
  return usedCount >= BEHAVIOUR_USED_BB_DIAGRAM_THRESHOLD;
}

function isTautology(name: string, description: string): boolean {
  const normalize = (s: string): string =>
    s
      .toLowerCase()
      .replace(/[\s\p{P}]+/gu, " ")
      .trim();
  const n = normalize(name);
  const d = normalize(description);
  if (n.length === 0 || d.length === 0) return false;
  return (
    d === n ||
    d.startsWith(`${n} `) ||
    d.endsWith(` ${n}`) ||
    (d.includes(n) && d.length < n.length + 20)
  );
}

function formatBlockPath(bcName: string, moduleName: string | null, bbName: string): string {
  const mid = moduleName === null ? "" : `${moduleName}/`;
  return `${bcName}/${mid}${bbName}`;
}

function validateRemovedNotReferenced(doc: DesignDoc, report: QualityReport): void {
  const removedBBNames = collectRemovedBuildingBlockNames(doc);
  if (removedBBNames.size === 0) return;
  for (const ref of collectBuildingBlockReferences(doc)) {
    if (removedBBNames.has(ref.name)) {
      report.errors.push(
        `Building Block '${ref.name}' is listed in 'removed' but still referenced as ${ref.kind} at '${ref.location}'. ` +
          `Update or drop the reference before saving.`
      );
    }
  }
}

function validateImplementsResolution(doc: DesignDoc, report: QualityReport): void {
  const declared = collectDeclaredBuildingBlockNames(doc);
  for (const bb of iterateBuildingBlocks(doc)) {
    for (const baseName of bb.bb.implements ?? []) {
      if (!declared.has(baseName)) {
        report.warnings.push(
          `Building Block '${bb.location}' implements '${baseName}' which is not declared in this DesignDoc — ` +
            `verify it exists in the prior model, or add it as a Building Block in this iteration.`
        );
      }
    }
  }
}

interface BuildingBlockReference {
  name: string;
  kind: "input" | "output" | "usedBuildingBlock" | "property type" | "implements";
  location: string;
}

interface BuildingBlockAt {
  bb: DesignedBuildingBlock;
  location: string;
}

function collectRemovedBuildingBlockNames(doc: DesignDoc): Set<string> {
  const names = new Set<string>();
  for (const bc of [
    ...(doc.boundedContexts?.added ?? []),
    ...(doc.boundedContexts?.modified ?? []),
  ]) {
    for (const n of bc.buildingBlocks?.removed ?? []) names.add(n);
    for (const m of [...(bc.modules?.added ?? []), ...(bc.modules?.modified ?? [])]) {
      for (const n of m.buildingBlocks?.removed ?? []) names.add(n);
    }
  }
  return names;
}

function collectDeclaredBuildingBlockNames(doc: DesignDoc): Set<string> {
  const names = new Set<string>();
  for (const entry of iterateBuildingBlocks(doc)) {
    names.add(entry.bb.name);
  }
  return names;
}

function* iterateBuildingBlocks(doc: DesignDoc): Generator<BuildingBlockAt> {
  for (const bc of [
    ...(doc.boundedContexts?.added ?? []),
    ...(doc.boundedContexts?.modified ?? []),
  ]) {
    for (const bb of [
      ...(bc.buildingBlocks?.added ?? []),
      ...(bc.buildingBlocks?.modified ?? []),
    ]) {
      yield { bb, location: formatBlockPath(bc.name, null, bb.name) };
    }
    for (const m of [...(bc.modules?.added ?? []), ...(bc.modules?.modified ?? [])]) {
      for (const bb of [
        ...(m.buildingBlocks?.added ?? []),
        ...(m.buildingBlocks?.modified ?? []),
      ]) {
        yield { bb, location: formatBlockPath(bc.name, m.name, bb.name) };
      }
    }
  }
}

function* collectBuildingBlockReferences(doc: DesignDoc): Generator<BuildingBlockReference> {
  for (const entry of iterateBuildingBlocks(doc)) {
    for (const baseName of entry.bb.implements ?? []) {
      yield { name: baseName, kind: "implements", location: entry.location };
    }
    for (const p of entry.bb.properties?.added ?? []) {
      if (p.type !== null && p.type !== "") {
        yield {
          name: p.type,
          kind: "property type",
          location: `${entry.location}.${p.name}`,
        };
      }
    }
    for (const p of entry.bb.properties?.modified ?? []) {
      if (p.type !== null && p.type !== "") {
        yield {
          name: p.type,
          kind: "property type",
          location: `${entry.location}.${p.name}`,
        };
      }
    }
    for (const bh of [
      ...(entry.bb.behaviours?.added ?? []),
      ...(entry.bb.behaviours?.modified ?? []),
    ]) {
      const behaviourPath = `${entry.location}.${bh.name}`;
      for (const n of bh.input?.added ?? []) {
        yield { name: n, kind: "input", location: behaviourPath };
      }
      for (const n of bh.output?.added ?? []) {
        yield { name: n, kind: "output", location: behaviourPath };
      }
      for (const n of bh.usedBuildingBlocks?.added ?? []) {
        yield {
          name: n,
          kind: "usedBuildingBlock",
          location: behaviourPath,
        };
      }
    }
  }
}

function formatQualityErrors(errors: string[]): string {
  return `DesignDoc quality gate rejected the save:\n- ${errors.join("\n- ")}`;
}

export type ElementKind =
  | "actor"
  | "qualityAttribute"
  | "boundedContext"
  | "module"
  | "buildingBlock"
  | "behavior"
  | "rule"
  | "scenario";

export interface ElementPathSegment {
  kind: ElementKind;
  name: string;
}

interface LocatedElement {
  element:
    | DesignedActor
    | DesignedQualityAttribute
    | DesignedBoundedContext
    | DesignedDomainModule
    | DesignedBuildingBlock
    | DesignedBehaviour
    | DesignedRule
    | DesignedScenario;
}

function describePath(path: ElementPathSegment[]): string {
  return path.map((p) => `${p.kind}:${p.name}`).join(" / ");
}

function locateElement(source: DesignDoc, path: ElementPathSegment[]): LocatedElement | null {
  if (path.length === 0) return null;
  const [head, ...rest] = path;
  switch (head.kind) {
    case "actor": {
      if (rest.length !== 0) return null;
      const a = findInChangeSet(source.actors, head.name);
      return a === null ? null : { element: a };
    }
    case "qualityAttribute": {
      if (rest.length !== 0) return null;
      const q = findInChangeSet(source.qualityAttributes, head.name);
      return q === null ? null : { element: q };
    }
    case "boundedContext": {
      const bc = findInChangeSet(source.boundedContexts, head.name);
      if (bc === null) return null;
      if (rest.length === 0) return { element: bc };
      return locateInBoundedContext(bc, rest);
    }
    default:
      return null;
  }
}

function locateInBoundedContext(
  bc: DesignedBoundedContext,
  path: ElementPathSegment[]
): LocatedElement | null {
  const [head, ...rest] = path;
  switch (head.kind) {
    case "module": {
      const m = findInChangeSet(bc.modules, head.name);
      if (m === null) return null;
      if (rest.length === 0) return { element: m };
      return locateInModule(m, rest);
    }
    case "buildingBlock": {
      const bb = findInChangeSet(bc.buildingBlocks, head.name);
      if (bb === null) return null;
      if (rest.length === 0) return { element: bb };
      return locateInBuildingBlock(bb, rest);
    }
    default:
      return null;
  }
}

function locateInModule(
  m: DesignedDomainModule,
  path: ElementPathSegment[]
): LocatedElement | null {
  const [head, ...rest] = path;
  if (head.kind !== "buildingBlock") return null;
  const bb = findInChangeSet(m.buildingBlocks, head.name);
  if (bb === null) return null;
  if (rest.length === 0) return { element: bb };
  return locateInBuildingBlock(bb, rest);
}

function locateInBuildingBlock(
  bb: DesignedBuildingBlock,
  path: ElementPathSegment[]
): LocatedElement | null {
  const [head, ...rest] = path;
  switch (head.kind) {
    case "behavior": {
      const bh = findInChangeSet(bb.behaviours, head.name);
      if (bh === null) return null;
      if (rest.length === 0) return { element: bh };
      return locateInBehavior(bh, rest);
    }
    case "rule": {
      if (rest.length !== 0) return null;
      const r = findInChangeSet(bb.rules, head.name);
      return r === null ? null : { element: r };
    }
    case "scenario": {
      if (rest.length !== 0) return null;
      const s = findInChangeSet(bb.scenarios, head.name);
      return s === null ? null : { element: s };
    }
    default:
      return null;
  }
}

function locateInBehavior(
  bh: DesignedBehaviour,
  path: ElementPathSegment[]
): LocatedElement | null {
  if (path.length !== 1) return null;
  const seg = path[0];
  switch (seg.kind) {
    case "rule": {
      const r = findInChangeSet(bh.rules, seg.name);
      return r === null ? null : { element: r };
    }
    case "scenario": {
      const s = findInChangeSet(bh.scenarios, seg.name);
      return s === null ? null : { element: s };
    }
    default:
      return null;
  }
}

function findInChangeSet<T extends { name: string }>(
  cs: { added: T[]; modified: T[]; removed: string[] } | undefined,
  name: string
): T | null {
  if (cs === undefined) return null;
  return cs.added.find((x) => x.name === name) ?? cs.modified.find((x) => x.name === name) ?? null;
}
