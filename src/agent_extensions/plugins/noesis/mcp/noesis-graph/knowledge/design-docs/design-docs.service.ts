import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { readFile } from "fs/promises";
import {
  DesignDocSchema,
  type DesignDoc,
  type DesignDocOverview,
} from "../../../../shared-contracts/design-doc.js";
import { DesignDocsRepository } from "./design-docs.repository.js";

export interface SaveDesignDocResult {
  design_doc_id: string;
  totals: { added: number; modified: number; removed: number };
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

  async saveDesignDocFromFile(path: string): Promise<SaveDesignDocResult> {
    const doc = await this.readDesignDocFile(path);
    const applyResult = await this.repository.applyDesignDoc(doc);
    const totals = {
      added:
        applyResult.actors_added +
        applyResult.bounded_contexts_added +
        applyResult.quality_attributes_added,
      modified:
        applyResult.actors_modified +
        applyResult.bounded_contexts_modified +
        applyResult.quality_attributes_modified,
      removed:
        applyResult.actors_removed +
        applyResult.bounded_contexts_removed +
        applyResult.quality_attributes_removed,
    };
    this.logger.log(
      `Saved DesignDoc ${doc.id} (${doc.name}) — +${totals.added} added, ~${totals.modified} modified, -${totals.removed} removed`,
    );
    return { design_doc_id: doc.id, totals };
  }

  private async readDesignDocFile(path: string): Promise<DesignDoc> {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    return DesignDocSchema.parse(parsed);
  }
}
