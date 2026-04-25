import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { readFile, writeFile } from "fs/promises";
import {
  DesignDocSchema,
  type DesignDoc,
  type DesignDocOverview,
} from "../../../../shared-contracts/design-doc.js";
import {
  DesignDocsRepository,
  type ApplyResult,
} from "./design-docs.repository.js";

export interface SaveDesignDocResult extends ApplyResult {
  output_path: string | null;
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

  async saveDesignDocFromFile(
    inputPath: string,
    outputPath: string | null,
  ): Promise<SaveDesignDocResult> {
    const doc = await this.readDesignDocFile(inputPath);
    const applyResult = await this.repository.applyDesignDoc(doc);
    if (outputPath !== null) {
      await writeFile(outputPath, JSON.stringify(doc, null, 2), "utf-8");
    }
    this.logger.log(
      `Saved DesignDoc ${doc.id} (${doc.name}) — +${applyResult.bounded_contexts_added} BCs, +${applyResult.actors_added} actors`,
    );
    return { ...applyResult, output_path: outputPath };
  }

  private async readDesignDocFile(path: string): Promise<DesignDoc> {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    return DesignDocSchema.parse(parsed);
  }
}
