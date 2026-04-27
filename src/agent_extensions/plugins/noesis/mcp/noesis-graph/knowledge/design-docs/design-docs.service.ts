import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { readFile } from "fs/promises";
import {
  DesignDocSchema,
  type DesignDoc,
  type DesignDocOverview,
  type DesignedBoundedContext,
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

export interface SaveDesignDocResult {
  status: "Ok";
  design_doc_id: string;
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
    await this.repository.applyDesignDoc(doc, todayDate());
    this.logger.log(`Saved DesignDoc ${doc.id} (${doc.name})`);
    return { status: "Ok", design_doc_id: doc.id };
  }

  async saveDesignDoc(
    doc: DesignDoc,
    date: string,
  ): Promise<SaveDesignDocResult> {
    await this.repository.applyDesignDoc(doc, date);
    this.logger.log(`Saved DesignDoc ${doc.id} (${doc.name})`);
    return { status: "Ok", design_doc_id: doc.id };
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
