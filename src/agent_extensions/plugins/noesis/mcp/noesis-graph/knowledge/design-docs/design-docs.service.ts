import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { readFile } from "fs/promises";
import {
  DesignDocSchema,
  type DesignDoc,
  type DesignDocOverview,
  type DesignedBoundedContext,
} from "../../../../shared-contracts/design-doc.js";
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
    await this.repository.applyDesignDoc(doc);
    this.logger.log(`Saved DesignDoc ${doc.id} (${doc.name})`);
    return { status: "Ok", design_doc_id: doc.id };
  }

  private async readDesignDocFile(path: string): Promise<DesignDoc> {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    return DesignDocSchema.parse(parsed);
  }
}
