import { Inject, Injectable } from "@nestjs/common";
import { existsSync, readFileSync, rmSync } from "fs";
import {
  DesignDocFileNewSchema,
  type DesignDocFileNew,
  type DesignedActorNew,
  type DesignedBehaviourNew,
  type DesignedBoundedContextNew,
  type DesignedBuildingBlockNew,
  type DesignedDomainModuleNew,
  type DesignedQualityAttributeNew,
  type DesignedRuleNew,
  type DesignedScenarioNew,
} from "../../../../shared-contracts/design-doc-new.js";
import type {
  DesignDocDetailData,
  DesignDocListItem,
  DesignDocsPageData,
  DesignDocSourceData,
} from "../../ui-contracts/design-docs/design-docs-data.js";
import { PROJECT_DIR } from "../../config/config.module.js";
import {
  detectDesignDocConflicts,
  resolveDesignDocLockedFields,
  type ConfirmedEdit,
} from "../locks.js";
import { DesignDocsRepository } from "./design-docs.repository.js";

export interface IndexFileOutcome {
  status: "indexed" | "unchanged";
  design_doc_id: string;
}

export interface PrepareDesignDocPathInput {
  id?: string;
  name: string;
}

export interface PrepareDesignDocPathOk {
  status: "Ok";
  id: string;
  canonical_path: string;
}

export interface PrepareDesignDocPathAlreadyImplemented {
  status: "AlreadyImplemented";
  design_doc_id: string;
  name: string;
}

export type PrepareDesignDocPathResult =
  | PrepareDesignDocPathOk
  | PrepareDesignDocPathAlreadyImplemented;

export class DesignDocImplementedError extends Error {
  constructor(
    public readonly designDocId: string,
    public readonly designDocName: string,
  ) {
    super(
      `Design doc '${designDocName}' (${designDocId}) is marked as implemented and is read-only. ` +
        `Create a new design doc to capture further changes.`,
    );
    this.name = "DesignDocImplementedError";
  }
}

export type ElementKind =
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

export interface ElementUpdateFields {
  name?: string;
  description?: string;
  given?: string;
  when?: string;
  then?: string;
}

export interface SaveDesignDocResult {
  status: "Ok";
  design_doc_id: string;
  canonical_path: string;
  warnings: string[];
}

export interface DesignDocOverview {
  id: string;
  name: string;
  description: string;
  date: string;
  edited_by_user: boolean;
  implemented: boolean;
  bounded_context_count: number;
}

export interface BoundedContextMapEntry {
  design_doc_id: string;
  design_doc_name: string;
  bounded_context_name: string;
  description: string;
  modules: Array<{ name: string; description: string }>;
}

export interface ModelTarget {
  design_doc_id: string;
  bounded_context_name: string;
  module_name: string | null;
}

type EditableElement =
  | DesignedActorNew
  | DesignedBehaviourNew
  | DesignedBoundedContextNew
  | DesignedBuildingBlockNew
  | DesignedDomainModuleNew
  | DesignedQualityAttributeNew
  | DesignedRuleNew
  | DesignedScenarioNew;

@Injectable()
export class DesignDocsService {
  constructor(
    @Inject(PROJECT_DIR) private readonly projectDir: string,
    private readonly repository: DesignDocsRepository,
  ) {}

  async deleteDesignDoc(designDocId: string): Promise<{ id: string }> {
    const path = this.repository.findFileById(this.projectDir, designDocId);
    if (path !== null) {
      this.repository.deleteFile(path);
    }
    if (await this.repository.exists(designDocId)) {
      await this.repository.delete(designDocId);
    }
    return { id: designDocId };
  }

  async deleteForFile(
    absPath: string,
  ): Promise<{ design_doc_id: string } | null> {
    const all = await this.repository.listAll();
    const target = all.find((row) => row.source_path === absPath);
    if (target === undefined) return null;
    await this.repository.delete(target.id);
    rmSync(absPath, { force: true });
    return { design_doc_id: target.id };
  }

  async editTopFieldsAndLock(
    designDocId: string,
    fields: { name?: string; description?: string },
    confirmedByUser: boolean,
  ): Promise<{ updated: Array<"name" | "description"> }> {
    const path = await this.requireFilePath(designDocId);
    const file = this.repository.readFile(path);
    if (file.implemented) {
      throw new Error(
        `DesignDoc ${designDocId} is marked implemented and cannot be modified.`,
      );
    }
    const updated: Array<"name" | "description"> = [];
    let next: DesignDocFileNew = file;
    if (fields.name !== undefined && file.name !== fields.name) {
      if (file.name_locked && !confirmedByUser) {
        throw new Error(
          `DesignDoc ${file.id}: field "name" is locked; pass confirmedByUser=true to override.`,
        );
      }
      next = { ...next, name: fields.name, name_locked: true };
      updated.push("name");
    }
    if (
      fields.description !== undefined &&
      file.description !== fields.description
    ) {
      if (file.description_locked && !confirmedByUser) {
        throw new Error(
          `DesignDoc ${file.id}: field "description" is locked; pass confirmedByUser=true to override.`,
        );
      }
      next = { ...next, description: fields.description, description_locked: true };
      updated.push("description");
    }
    if (updated.length === 0) return { updated: [] };
    this.persistFile(next);
    return { updated };
  }

  async getDesignDocDetail(designDocId: string): Promise<DesignDocDetailData> {
    const head = await this.repository.read(designDocId);
    if (head === null) {
      throw new Error(`DesignDoc not found: ${designDocId}`);
    }
    const file = this.repository.readFile(head.source_path);
    return {
      id: head.id,
      name: head.name,
      description: head.description,
      date: deriveDesignDocDate(file),
      implemented: head.implemented,
      source: file as unknown as DesignDocSourceData,
    };
  }

  async getDesignDocsPage(): Promise<DesignDocsPageData> {
    const overviews = await this.listDesignDocs();
    const docs: DesignDocListItem[] = overviews
      .map((o) => ({
        id: o.id,
        date: o.date,
        title: o.name,
        description: o.description,
        edited_by_user: o.edited_by_user,
        implemented: o.implemented,
      }))
      .sort(byDateDesc);
    return { docs };
  }

  async indexFile(absPath: string): Promise<IndexFileOutcome> {
    const sha = this.repository.fileSha(absPath);
    const file = this.repository.readFile(absPath);
    const stored = await this.repository.read(file.id);
    if (stored !== null && stored.sha === sha && stored.source_path === absPath) {
      return { status: "unchanged", design_doc_id: file.id };
    }
    await this.repository.upsert(file, sha, absPath);
    return { status: "indexed", design_doc_id: file.id };
  }

  async listActors(): Promise<
    Array<{ name: string; description: string; description_locked: boolean }>
  > {
    return this.repository.listActors();
  }

  async listAllStoredFiles(): Promise<
    Array<{ id: string; path: string; sha: string }>
  > {
    return this.repository.listAllStoredFiles();
  }

  async listDesignDocs(): Promise<DesignDocOverview[]> {
    const stored = await this.repository.listAll();
    const out: DesignDocOverview[] = [];
    for (const head of stored) {
      const file = this.tryReadFileByPath(head.source_path);
      if (file === null) continue;
      out.push({
        id: head.id,
        name: head.name,
        description: head.description,
        date: deriveDesignDocDate(file),
        edited_by_user: hasUserLocks(file),
        implemented: head.implemented,
        bounded_context_count: file.boundedContexts?.added.length ?? 0,
      });
    }
    return out;
  }

  async markImplemented(designDocId: string): Promise<{ design_doc_id: string }> {
    const path = await this.requireFilePath(designDocId);
    const file = this.repository.readFile(path);
    if (file.implemented) return { design_doc_id: file.id };
    const next: DesignDocFileNew = { ...file, implemented: true };
    this.repository.writeFile(path, next);
    if (await this.repository.exists(designDocId)) {
      await this.repository.writeImplementedFlag(designDocId, true);
    }
    return { design_doc_id: file.id };
  }

  /**
   * Read + validate a design-doc working file without writing anything. Returned shape
   * matches the persisted schema. Throws if the working file is missing or malformed.
   */
  loadWorkingFile(workingDirPath: string): DesignDocFileNew {
    if (!existsSync(workingDirPath)) {
      throw new Error(`Design doc working file not found: ${workingDirPath}`);
    }
    return DesignDocFileNewSchema.parse(
      JSON.parse(readFileSync(workingDirPath, "utf-8")),
    );
  }

  /**
   * Conflict detector for the upload-time lock model. Compares the proposed file against
   * the current canonical file (if any) and returns one ConfirmedEdit entry per locked
   * field whose value would change. Empty array when there is no canonical file yet.
   */
  detectConflicts(file: DesignDocFileNew): ConfirmedEdit[] {
    const existing = this.readCanonicalIfExists(file.id);
    return detectDesignDocConflicts(existing, file);
  }

  /**
   * Save an in-memory design-doc file to its canonical location, blindly overwriting
   * the prior canonical content. Used by editTopFieldsAndLock (which has already
   * validated locks) and by tests for setup. Lock-aware skill uploads should go
   * through persistFromWorkingFile instead.
   */
  persistFile(file: DesignDocFileNew): string {
    const newPath = this.canonicalPath(file.id, file.name);
    const previous = this.repository.findFileById(this.projectDir, file.id);
    if (previous !== null && previous !== newPath) {
      this.repository.deleteFile(previous);
    }
    this.repository.writeFile(newPath, file);
    return newPath;
  }

  /**
   * DocumentsService calls this with the working-dir path to the design-doc JSON.
   * Reads + validates + writes to the canonical path, removing the prior canonical
   * file when the rename changes the filename. Locked fields whose value would change
   * are preserved unless the corresponding ConfirmedEdit is present in `confirmed`.
   * For each cleared lock, the new value is written and the lock flag is reset to false.
   */
  persistFromWorkingFile(
    workingDirPath: string,
    confirmed: Set<string> = new Set(),
  ): { path: string; cleared: ConfirmedEdit[] } {
    const file = this.loadWorkingFile(workingDirPath);
    const existing = this.readCanonicalIfExists(file.id);
    const cleared: ConfirmedEdit[] = [];
    const resolved = resolveDesignDocLockedFields(existing, file, confirmed, cleared);
    const merged: DesignDocFileNew = {
      ...file,
      name: resolved.name,
      name_locked: resolved.name_locked,
      description: resolved.description,
      description_locked: resolved.description_locked,
    };
    return { path: this.persistFile(merged), cleared };
  }

  private readCanonicalIfExists(designDocId: string): DesignDocFileNew | null {
    const path = this.repository.findFileById(this.projectDir, designDocId);
    if (path === null) return null;
    return this.repository.readFile(path);
  }

  async readBoundedContextMap(): Promise<BoundedContextMapEntry[]> {
    const stored = await this.repository.listAll();
    const entries: BoundedContextMapEntry[] = [];
    for (const head of stored) {
      const file = this.tryReadFileByPath(head.source_path);
      if (file === null) continue;
      for (const bc of file.boundedContexts?.added ?? []) {
        entries.push({
          design_doc_id: head.id,
          design_doc_name: head.name,
          bounded_context_name: bc.name,
          description: bc.description ?? "",
          modules: (bc.modules?.added ?? []).map((m) => ({
            name: m.name,
            description: m.description ?? "",
          })),
        });
      }
    }
    return entries;
  }

  async readDesignDoc(designDocId: string): Promise<DesignDocFileNew | null> {
    const head = await this.repository.read(designDocId);
    if (head === null) return null;
    return this.tryReadFileByPath(head.source_path);
  }

  async readModelForTargets(
    targets: ModelTarget[],
  ): Promise<DesignedBoundedContextNew[]> {
    if (targets.length === 0) return [];
    const stored = await this.repository.listAll();
    const docsById = new Map<string, DesignDocFileNew>();
    for (const head of stored) {
      const file = this.tryReadFileByPath(head.source_path);
      if (file !== null) docsById.set(head.id, file);
    }
    const out: DesignedBoundedContextNew[] = [];
    for (const target of targets) {
      const file = docsById.get(target.design_doc_id);
      if (file === undefined) continue;
      const bc = (file.boundedContexts?.added ?? []).find(
        (b) => b.name === target.bounded_context_name,
      );
      if (bc === undefined) continue;
      out.push(narrowBoundedContext(bc, target.module_name));
    }
    return out;
  }

  async saveFromFile(
    workingDirPath: string,
    confirmedEdits: ConfirmedEdit[] = [],
    confirmedDrops: string[] = [],
  ): Promise<SaveDesignDocResult> {
    void confirmedDrops;
    const file = this.loadWorkingFile(workingDirPath);
    const head = await this.repository.read(file.id);
    if (head !== null && head.implemented) {
      throw new DesignDocImplementedError(file.id, head.name);
    }
    const confirmedSet = new Set(confirmedEdits.map(confirmedKey));
    const result = this.persistFromWorkingFile(workingDirPath, confirmedSet);
    return {
      status: "Ok",
      design_doc_id: file.id,
      canonical_path: result.path,
      warnings: [],
    };
  }

  async updateElement(
    designDocId: string,
    path: ElementPathSegment[],
    fields: ElementUpdateFields,
  ): Promise<{ ok: true }> {
    if (path.length === 0) {
      throw new Error("Element path must not be empty");
    }
    const head = await this.repository.read(designDocId);
    if (head !== null && head.implemented) {
      throw new DesignDocImplementedError(designDocId, head.name);
    }
    const filePath = this.repository.findFileById(this.projectDir, designDocId);
    if (filePath === null) {
      throw new Error(`DesignDoc on-disk file missing for: ${designDocId}`);
    }
    const file = this.repository.readFile(filePath);
    const target = locateElement(file, path);
    if (target === null) {
      throw new Error(`Element not found at path: ${describePath(path)}`);
    }
    applyElementFieldEdits(target, fields, path);
    this.persistFile(file);
    return { ok: true };
  }

  async upsertActor(actor: {
    name: string;
    description: string | null;
  }): Promise<{ status: "Ok"; name: string }> {
    if (actor.name.trim() === "") {
      throw new Error("Actor name must not be empty");
    }
    await this.repository.upsertActor(actor);
    return { status: "Ok", name: actor.name };
  }

  async prepareDesignDocPath(
    input: PrepareDesignDocPathInput,
  ): Promise<PrepareDesignDocPathResult> {
    if (input.id !== undefined) {
      const implemented = await this.repository.readImplementedFlag(input.id);
      if (implemented === true) {
        return {
          status: "AlreadyImplemented",
          design_doc_id: input.id,
          name: input.name,
        };
      }
    }
    const id = input.id ?? crypto.randomUUID();
    return {
      status: "Ok",
      id,
      canonical_path: this.canonicalPath(id, input.name),
    };
  }

  private canonicalPath(id: string, name: string): string {
    return this.repository.canonicalPath(this.projectDir, id, name);
  }

  private async requireFilePath(designDocId: string): Promise<string> {
    const path = this.repository.findFileById(this.projectDir, designDocId);
    if (path === null) {
      throw new Error(`DesignDoc ${designDocId} has no source file on disk.`);
    }
    return path;
  }

  private tryReadFileByPath(path: string): DesignDocFileNew | null {
    if (!existsSync(path)) return null;
    try {
      return this.repository.readFile(path);
    } catch {
      return null;
    }
  }
}

function applyElementFieldEdits(
  element: EditableElement,
  fields: ElementUpdateFields,
  path: ElementPathSegment[],
): void {
  if (fields.name !== undefined) {
    const trimmed = fields.name.trim();
    if (trimmed === "") throw new Error("Element name must not be empty");
    if (trimmed !== element.name) {
      element.name = trimmed;
      (element as { name_locked?: boolean }).name_locked = true;
    }
  }
  if (fields.description !== undefined && "description" in element) {
    const next = fields.description;
    const lockable = element as {
      description?: string | null;
      description_locked?: boolean;
    };
    if (lockable.description !== next) {
      lockable.description = next;
      lockable.description_locked = true;
    }
  }
  const isScenario = path[path.length - 1]?.kind === "scenario";
  if (fields.given !== undefined) {
    if (!isScenario) throw new Error("'given' is only valid for scenario elements");
    const sc = element as DesignedScenarioNew;
    if (sc.given !== fields.given) {
      sc.given = fields.given;
      sc.given_locked = true;
    }
  }
  if (fields.when !== undefined) {
    if (!isScenario) throw new Error("'when' is only valid for scenario elements");
    const sc = element as DesignedScenarioNew;
    if (sc.when !== fields.when) {
      sc.when = fields.when;
      sc.when_locked = true;
    }
  }
  if (fields.then !== undefined) {
    if (!isScenario) throw new Error("'then' is only valid for scenario elements");
    const sc = element as DesignedScenarioNew;
    if (sc.then !== fields.then) {
      sc.then = fields.then;
      sc.then_locked = true;
    }
  }
}

function byDateDesc(a: { date: string }, b: { date: string }): number {
  if (a.date === b.date) return 0;
  if (a.date === "") return 1;
  if (b.date === "") return -1;
  return a.date < b.date ? 1 : -1;
}

function confirmedKey(edit: ConfirmedEdit): string {
  return JSON.stringify(edit);
}

function describePath(path: ElementPathSegment[]): string {
  return path.map((p) => `${p.kind}:${p.name}`).join(" / ");
}

function deriveDesignDocDate(file: DesignDocFileNew): string {
  return file.date;
}

function findInChangeSet<T extends { name: string }>(
  cs: { added: T[]; modified: T[]; removed: string[] } | undefined,
  name: string,
): T | null {
  if (cs === undefined) return null;
  return (
    cs.added.find((x) => x.name === name) ??
    cs.modified.find((x) => x.name === name) ??
    null
  );
}

function hasUserLocks(file: DesignDocFileNew): boolean {
  if (file.name_locked || file.description_locked) return true;
  for (const actor of file.actors) {
    if (actor.name_locked || actor.description_locked) return true;
  }
  for (const bc of file.boundedContexts?.added ?? []) {
    if (boundedContextHasLocks(bc)) return true;
  }
  return false;
}

function boundedContextHasLocks(bc: DesignedBoundedContextNew): boolean {
  if (bc.name_locked || bc.description_locked) return true;
  for (const m of bc.modules?.added ?? []) {
    if (moduleHasLocks(m)) return true;
  }
  for (const bb of bc.buildingBlocks?.added ?? []) {
    if (buildingBlockHasLocks(bb)) return true;
  }
  for (const qa of bc.qualityAttributes?.added ?? []) {
    if (qa.name_locked || qa.description_locked) return true;
  }
  return false;
}

function moduleHasLocks(m: DesignedDomainModuleNew): boolean {
  if (m.name_locked || m.description_locked) return true;
  for (const bb of m.buildingBlocks?.added ?? []) {
    if (buildingBlockHasLocks(bb)) return true;
  }
  for (const qa of m.qualityAttributes?.added ?? []) {
    if (qa.name_locked || qa.description_locked) return true;
  }
  return false;
}

function buildingBlockHasLocks(bb: DesignedBuildingBlockNew): boolean {
  if (bb.name_locked || bb.description_locked) return true;
  for (const bh of bb.behaviours?.added ?? []) {
    if (bh.name_locked || bh.description_locked) return true;
    for (const r of bh.rules?.added ?? []) {
      if (r.name_locked || r.description_locked) return true;
    }
    for (const s of bh.scenarios?.added ?? []) {
      if (
        s.name_locked ||
        s.description_locked ||
        s.given_locked ||
        s.when_locked ||
        s.then_locked
      ) {
        return true;
      }
    }
  }
  for (const r of bb.rules?.added ?? []) {
    if (r.name_locked || r.description_locked) return true;
  }
  for (const s of bb.scenarios?.added ?? []) {
    if (
      s.name_locked ||
      s.description_locked ||
      s.given_locked ||
      s.when_locked ||
      s.then_locked
    ) {
      return true;
    }
  }
  for (const qa of bb.qualityAttributes?.added ?? []) {
    if (qa.name_locked || qa.description_locked) return true;
  }
  return false;
}

function locateElement(
  file: DesignDocFileNew,
  path: ElementPathSegment[],
): EditableElement | null {
  if (path.length === 0) return null;
  const [head, ...rest] = path;
  if (head.kind !== "boundedContext") return null;
  const bc = findInChangeSet(file.boundedContexts, head.name);
  if (bc === null) return null;
  if (rest.length === 0) return bc;
  return locateInBoundedContext(bc, rest);
}

function locateInBoundedContext(
  bc: DesignedBoundedContextNew,
  path: ElementPathSegment[],
): EditableElement | null {
  const [head, ...rest] = path;
  switch (head.kind) {
    case "module": {
      const m = findInChangeSet(bc.modules, head.name);
      if (m === null) return null;
      if (rest.length === 0) return m;
      return locateInModule(m, rest);
    }
    case "buildingBlock": {
      const bb = findInChangeSet(bc.buildingBlocks, head.name);
      if (bb === null) return null;
      if (rest.length === 0) return bb;
      return locateInBuildingBlock(bb, rest);
    }
    case "qualityAttribute": {
      if (rest.length !== 0) return null;
      return findInChangeSet(bc.qualityAttributes, head.name);
    }
    default:
      return null;
  }
}

function locateInModule(
  m: DesignedDomainModuleNew,
  path: ElementPathSegment[],
): EditableElement | null {
  const [head, ...rest] = path;
  switch (head.kind) {
    case "buildingBlock": {
      const bb = findInChangeSet(m.buildingBlocks, head.name);
      if (bb === null) return null;
      if (rest.length === 0) return bb;
      return locateInBuildingBlock(bb, rest);
    }
    case "qualityAttribute": {
      if (rest.length !== 0) return null;
      return findInChangeSet(m.qualityAttributes, head.name);
    }
    default:
      return null;
  }
}

function locateInBuildingBlock(
  bb: DesignedBuildingBlockNew,
  path: ElementPathSegment[],
): EditableElement | null {
  const [head, ...rest] = path;
  switch (head.kind) {
    case "behavior": {
      const bh = findInChangeSet(bb.behaviours, head.name);
      if (bh === null) return null;
      if (rest.length === 0) return bh;
      return locateInBehavior(bh, rest);
    }
    case "rule":
      return rest.length === 0 ? findInChangeSet(bb.rules, head.name) : null;
    case "scenario":
      return rest.length === 0 ? findInChangeSet(bb.scenarios, head.name) : null;
    case "qualityAttribute":
      return rest.length === 0
        ? findInChangeSet(bb.qualityAttributes, head.name)
        : null;
    default:
      return null;
  }
}

function locateInBehavior(
  bh: DesignedBehaviourNew,
  path: ElementPathSegment[],
): EditableElement | null {
  if (path.length !== 1) return null;
  const seg = path[0];
  switch (seg.kind) {
    case "rule":
      return findInChangeSet(bh.rules, seg.name);
    case "scenario":
      return findInChangeSet(bh.scenarios, seg.name);
    case "qualityAttribute":
      return findInChangeSet(bh.qualityAttributes, seg.name);
    default:
      return null;
  }
}

function narrowBoundedContext(
  bc: DesignedBoundedContextNew,
  moduleName: string | null,
): DesignedBoundedContextNew {
  if (moduleName === null) return bc;
  const matchingModules = (bc.modules?.added ?? []).filter(
    (m) => m.name === moduleName,
  );
  return {
    ...bc,
    modules: bc.modules
      ? { added: matchingModules, modified: [], removed: [] }
      : undefined,
    buildingBlocks: { added: [], modified: [], removed: [] },
  };
}
