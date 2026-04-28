import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { readFile } from "fs/promises";
import {
  DesignDocSchema,
  type DesignDoc,
  type DesignDocOverview,
  type DesignedBehaviour,
  type DesignedBoundedContext,
  type DesignedBuildingBlock,
  type DesignedDomainModule,
  type DesignedRule,
} from "../../../../shared-contracts/design-doc.js";
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
  warnings: string[];
}

@Injectable()
export class DesignDocsService implements OnModuleInit {
  private readonly logger = new Logger(DesignDocsService.name);

  constructor(private readonly repository: DesignDocsRepository) {}

  async onModuleInit(): Promise<void> {
    await this.repository.initSchema();
  }

  async deleteDesignDoc(designDocId: string): Promise<{ id: string }> {
    await this.repository.deleteDesignDoc(designDocId);
    return { id: designDocId };
  }

  async getDesignDocDetail(
    designDocId: string,
  ): Promise<DesignDocDetailData> {
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
      }))
      .sort(byDateDesc);
    return { docs };
  }

  async listDesignDocs(): Promise<DesignDocOverview[]> {
    return this.repository.listDesignDocs();
  }

  async readDesignDoc(designDocId: string): Promise<DesignDoc | null> {
    return this.repository.readDesignDoc(designDocId);
  }

  async readBoundedContextMap(): Promise<BoundedContextMapEntry[]> {
    return this.repository.readBoundedContextMap();
  }

  async readModelForTargets(
    targets: ModelTarget[],
  ): Promise<DesignedBoundedContext[]> {
    return this.repository.readModelForTargets(targets);
  }

  async saveDesignDocFromFile(path: string): Promise<SaveDesignDocResult> {
    const doc = await this.readDesignDocFile(path);
    const { errors, warnings } = validateDesignDocQuality(doc);
    if (errors.length > 0) {
      throw new Error(formatQualityErrors(errors));
    }
    await this.repository.applyDesignDoc(doc, todayDate());
    this.logger.log(`Saved DesignDoc ${doc.id} (${doc.name})`);
    return { status: "Ok", design_doc_id: doc.id, warnings };
  }

  async saveDesignDoc(
    doc: DesignDoc,
    date: string,
  ): Promise<SaveDesignDocResult> {
    const { errors, warnings } = validateDesignDocQuality(doc);
    if (errors.length > 0) {
      throw new Error(formatQualityErrors(errors));
    }
    await this.repository.applyDesignDoc(doc, date);
    this.logger.log(`Saved DesignDoc ${doc.id} (${doc.name})`);
    return { status: "Ok", design_doc_id: doc.id, warnings };
  }

  private async findOverview(
    designDocId: string,
  ): Promise<DesignDocOverview | null> {
    const overviews = await this.repository.listDesignDocs();
    return overviews.find((o) => o.id === designDocId) ?? null;
  }

  private async readDesignDocFile(path: string): Promise<DesignDoc> {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    return DesignDocSchema.parse(parsed);
  }
}

function byDateDesc(
  a: { date: string },
  b: { date: string },
): number {
  if (a.date === b.date) return 0;
  if (a.date === "") return 1;
  if (b.date === "") return -1;
  return a.date < b.date ? 1 : -1;
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
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
  return report;
}

function validateBoundedContext(
  bc: DesignedBoundedContext,
  mode: "added" | "modified",
  report: QualityReport,
): void {
  if (mode === "added") {
    const directBlockCount = bc.buildingBlocks?.added.length ?? 0;
    const moduleCount = bc.modules?.added.length ?? 0;
    if (
      directBlockCount > BC_BUILDING_BLOCKS_FLAT_THRESHOLD &&
      moduleCount === 0
    ) {
      report.warnings.push(
        `Bounded Context '${bc.name}' has ${directBlockCount} building blocks and no modules — ` +
          `consider grouping them into 3–7 modules along the natural cohesion axes.`,
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
  report: QualityReport,
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
  report: QualityReport,
): void {
  const blockPath = formatBlockPath(bcName, moduleName, bb.name);
  for (const r of bb.rules?.added ?? []) {
    validateRule(blockPath, r, "added", report);
  }
  for (const r of bb.rules?.modified ?? []) {
    validateRule(blockPath, r, "modified", report);
  }
  for (const bh of bb.behaviours?.added ?? []) {
    validateBehaviour(blockPath, bh, "added", report);
  }
  for (const bh of bb.behaviours?.modified ?? []) {
    validateBehaviour(blockPath, bh, "modified", report);
  }
}

function validateBehaviour(
  blockPath: string,
  bh: DesignedBehaviour,
  mode: "added" | "modified",
  report: QualityReport,
): void {
  const behaviourPath = `${blockPath}.${bh.name}`;
  if (mode === "added") {
    if (bh.description === null || bh.description.length === 0) {
      report.errors.push(
        `Behaviour '${behaviourPath}' is missing description ` +
          `(required ≥${BEHAVIOUR_DESCRIPTION_MIN} chars for added behaviours).`,
      );
    } else if (bh.description.length < BEHAVIOUR_DESCRIPTION_MIN) {
      report.errors.push(
        `Behaviour '${behaviourPath}' description is ${bh.description.length} chars ` +
          `(need ≥${BEHAVIOUR_DESCRIPTION_MIN}). Cover Input / Validation / numbered Steps / Output.`,
      );
    } else if (
      shouldHaveDiagram(bh) &&
      !bh.description.includes("```mermaid")
    ) {
      report.warnings.push(
        `Behaviour '${behaviourPath}' is an application_service or uses ≥${BEHAVIOUR_USED_BB_DIAGRAM_THRESHOLD} ` +
          `building blocks — embed a \`\`\`mermaid sequence diagram in description for clarity.`,
      );
    }
  } else if (
    bh.description !== null &&
    bh.description.length > 0 &&
    bh.description.length < BEHAVIOUR_DESCRIPTION_MIN
  ) {
    report.errors.push(
      `Behaviour '${behaviourPath}' modified description is ${bh.description.length} chars ` +
        `(need ≥${BEHAVIOUR_DESCRIPTION_MIN}).`,
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
  report: QualityReport,
): void {
  const rulePath = `${parentPath}#${r.name}`;
  const tautological =
    r.description !== null &&
    r.description.length > 0 &&
    isTautology(r.name, r.description);
  if (mode === "added") {
    if (r.description === null || r.description.length === 0) {
      report.errors.push(
        `Rule '${rulePath}' is missing description ` +
          `(required ≥${RULE_DESCRIPTION_MIN} chars for added rules).`,
      );
    } else if (r.description.length < RULE_DESCRIPTION_MIN) {
      report.errors.push(
        `Rule '${rulePath}' description is ${r.description.length} chars ` +
          `(need ≥${RULE_DESCRIPTION_MIN}). Cover Trigger / Pre / Algorithm / Post / Edge cases.`,
      );
    } else if (tautological) {
      report.errors.push(
        `Rule '${rulePath}' description is a tautology — it paraphrases the rule name without an algorithm.`,
      );
    }
  } else if (
    r.description !== null &&
    r.description.length > 0 &&
    r.description.length < RULE_DESCRIPTION_MIN
  ) {
    report.errors.push(
      `Rule '${rulePath}' modified description is ${r.description.length} chars ` +
        `(need ≥${RULE_DESCRIPTION_MIN}).`,
    );
  }
}

function shouldHaveDiagram(bh: DesignedBehaviour): boolean {
  if (bh.type === undefined || bh.type === null) return false;
  // type is the Behaviour message kind; the heuristic uses building-block coupling.
  const usedCount = bh.usedBuildingBlocks?.added.length ?? 0;
  if (usedCount >= BEHAVIOUR_USED_BB_DIAGRAM_THRESHOLD) return true;
  return false;
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
  return d === n || d.startsWith(`${n} `) || d.endsWith(` ${n}`) || d.includes(n) && d.length < n.length + 20;
}

function formatBlockPath(
  bcName: string,
  moduleName: string | null,
  bbName: string,
): string {
  const mid = moduleName === null ? "" : `${moduleName}/`;
  return `${bcName}/${mid}${bbName}`;
}

function formatQualityErrors(errors: string[]): string {
  return `DesignDoc quality gate rejected the save:\n- ${errors.join("\n- ")}`;
}
