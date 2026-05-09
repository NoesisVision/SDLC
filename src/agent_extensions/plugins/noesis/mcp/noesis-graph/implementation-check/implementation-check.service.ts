import { Injectable } from "@nestjs/common";
import { readFile } from "fs/promises";
import { z } from "zod";
import { DesignDocsService } from "../knowledge/design-docs/design-docs.service.js";
import { ScannerService } from "../scanner/scanner.service.js";
import type { DomainModelTree } from "../scanner/domain-model/domain-model.js";
import { compareImplementation, type ComparisonResult } from "./comparison.js";

const DomainModelTreeSchema: z.ZodType<DomainModelTree> = z.lazy(() =>
  z.object({
    boundedContexts: z.array(
      z.object({
        name: z.string(),
        modules: z.array(z.lazy(() => ModuleBranchSchema)),
        buildingBlocks: z.array(BuildingBlockBranchSchema),
      }),
    ),
  }),
) as z.ZodType<DomainModelTree>;

const BehaviorSchema = z.object({
  id: z.string(),
  name: z.string(),
  actor: z.string().nullable(),
});

const BuildingBlockBranchSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  behaviors: z.array(BehaviorSchema),
});

const ModuleBranchSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    name: z.string(),
    fullPath: z.string(),
    modules: z.array(ModuleBranchSchema),
    buildingBlocks: z.array(BuildingBlockBranchSchema),
  }),
);

@Injectable()
export class ImplementationCheckService {
  constructor(
    private readonly scanner: ScannerService,
    private readonly designDocs: DesignDocsService,
  ) {}

  async scanToTree(): Promise<DomainModelTree> {
    return this.scanner.scanInMemory();
  }

  async compareImplementationToDesign(
    designDocId: string,
    beforeScanPath: string,
    afterScanPath: string,
  ): Promise<ComparisonResult> {
    const doc = await this.designDocs.readDesignDoc(designDocId);
    if (doc === null) {
      throw new Error(`DesignDoc not found: ${designDocId}`);
    }
    const before = await this.readScanFile(beforeScanPath);
    const after = await this.readScanFile(afterScanPath);
    // The static-comparison module reads the structural shape only (names,
    // hierarchy, behaviours, actors); it predates the per-field _locked fields
    // on the new schema, so we narrow to the legacy shape at this boundary.
    return compareImplementation({
      before,
      after,
      doc: doc as unknown as Parameters<typeof compareImplementation>[0]["doc"],
    });
  }

  private async readScanFile(path: string): Promise<DomainModelTree> {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    return DomainModelTreeSchema.parse(parsed);
  }
}
