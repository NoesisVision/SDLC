import { Inject, Injectable, Logger } from "@nestjs/common";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { basename } from "path";
import { PROJECT_DIR } from "../config/config.module.js";
import {
  classifySourceFilePath,
  computeFileSha,
  type SourceFileExtension,
  type SourceFileKind,
} from "../../../shared-contracts/source-files.js";
import { GraphProjectionService } from "./graph-projection.service.js";
import {
  SourceFilesRepository,
  type SourceFileRow,
} from "./source-files.repository.js";

export interface DetectedFile {
  kind: SourceFileKind;
  id: string;
  ext: SourceFileExtension;
}

export interface LoadResult {
  kind: SourceFileKind;
  id: string;
  sha: string;
  user_edit_detected: boolean;
}

@Injectable()
export class FileSyncService {
  private readonly logger = new Logger(FileSyncService.name);

  constructor(
    private readonly sourceFiles: SourceFilesRepository,
    private readonly projection: GraphProjectionService,
    @Inject(PROJECT_DIR) private readonly projectDir: string,
  ) {}

  detect(absPath: string): DetectedFile | null {
    const classified = classifySourceFilePath(this.projectDir, absPath);
    if (classified === null) return null;
    const id =
      classified.kind === "design_doc" && classified.ext === ".json"
        ? readDesignDocId(absPath)
        : basename(absPath, classified.ext);
    if (id === null) return null;
    return { kind: classified.kind, id, ext: classified.ext };
  }

  async loadFile(absPath: string): Promise<LoadResult | null> {
    const detected = this.detect(absPath);
    if (detected === null) return null;
    if (!existsSync(absPath)) return null;

    const sha = computeFileSha(absPath);
    const prior = await this.sourceFiles.get(absPath);
    const userEditDetected =
      prior !== null && prior.sha !== sha
        ? this.flagAsUserEdited(absPath, detected)
        : false;

    const finalSha = userEditDetected ? computeFileSha(absPath) : sha;
    await this.applyProjection(absPath, detected, finalSha);
    await this.upsertRegistryRow(absPath, detected, finalSha);
    return {
      kind: detected.kind,
      id: detected.id,
      sha: finalSha,
      user_edit_detected: userEditDetected,
    };
  }

  async registerWritten(absPath: string): Promise<LoadResult | null> {
    const detected = this.detect(absPath);
    if (detected === null || !existsSync(absPath)) return null;
    const sha = computeFileSha(absPath);
    await this.applyProjection(absPath, detected, sha);
    await this.upsertRegistryRow(absPath, detected, sha);
    return {
      kind: detected.kind,
      id: detected.id,
      sha,
      user_edit_detected: false,
    };
  }

  async removeFile(absPath: string): Promise<SourceFileRow | null> {
    const row = await this.sourceFiles.get(absPath);
    if (row === null) return null;
    await this.sourceFiles.remove(absPath);
    return row;
  }

  private async applyProjection(
    absPath: string,
    detected: DetectedFile,
    sha: string,
  ): Promise<void> {
    const editedByUser = readEditedByUserFlag(absPath, detected);
    await this.projection.project({
      kind: detected.kind,
      ext: detected.ext,
      id: detected.id,
      absPath,
      sha,
      editedByUser,
    });
  }

  private async upsertRegistryRow(
    absPath: string,
    detected: DetectedFile,
    sha: string,
  ): Promise<void> {
    await this.sourceFiles.upsert({
      path: absPath,
      kind: detected.kind,
      entity_id: detected.id,
      sha,
      indexed_at: new Date().toISOString(),
    });
  }

  private flagAsUserEdited(absPath: string, detected: DetectedFile): boolean {
    if (detected.ext !== ".json") return true;
    try {
      const raw = readFileSync(absPath, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed.edited_by_user === true) return true;
      parsed.edited_by_user = true;
      writeFileSync(absPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
      this.logger.log(
        `Detected user edit on ${absPath}; flagged edited_by_user=true`,
      );
      return true;
    } catch (err) {
      this.logger.warn(
        `Failed to flag user edit on ${absPath}: ${(err as Error).message}`,
      );
      return true;
    }
  }
}

function readEditedByUserFlag(
  absPath: string,
  detected: DetectedFile,
): boolean {
  if (detected.ext !== ".json") return false;
  try {
    const raw = readFileSync(absPath, "utf-8");
    const parsed = JSON.parse(raw) as { edited_by_user?: boolean };
    return parsed.edited_by_user === true;
  } catch {
    return false;
  }
}

function readDesignDocId(absPath: string): string | null {
  if (!existsSync(absPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(absPath, "utf-8")) as {
      id?: unknown;
    };
    if (typeof parsed.id === "string" && parsed.id !== "") return parsed.id;
  } catch {
    // fall through
  }
  return null;
}
