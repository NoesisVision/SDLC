import { Inject, Injectable, Logger } from "@nestjs/common";
import { existsSync, readdirSync, statSync } from "fs";
import { extname, join } from "path";
import {
  ensureNoesisLayout,
  noesisSubdirPath,
  type SourceFileKind,
} from "../../../shared-contracts/source-files.js";
import { PROJECT_DIR } from "../config/config.module.js";
import { FileLoaderService } from "../file-sync/file-loader.service.js";
import { SourceFilesRepository } from "../file-sync/source-files.repository.js";
import { IndexStateService } from "./index-state.service.js";

const KINDS: SourceFileKind[] = [
  "conversation",
  "document",
  "topic",
  "decision",
  "design_doc",
];

const VALID_EXTENSIONS = new Set([".md", ".json"]);

@Injectable()
export class IndexerService {
  private readonly logger = new Logger(IndexerService.name);

  constructor(
    @Inject(PROJECT_DIR) private readonly projectDir: string,
    private readonly state: IndexStateService,
    private readonly loader: FileLoaderService,
    private readonly sourceFiles: SourceFilesRepository,
  ) {}

  async runFullIndex(): Promise<void> {
    try {
      ensureNoesisLayout(this.projectDir);
      const discovered = this.discoverFiles();
      this.state.beginIndexing(discovered.length);
      const seenPaths = new Set<string>();
      for (const { path } of discovered) {
        seenPaths.add(path);
        try {
          await this.loader.loadFile(path);
        } catch (err) {
          this.logger.warn(
            `Failed to load ${path}: ${(err as Error).message}`,
          );
        }
        this.state.recordFileProcessed();
      }
      await this.removeVanished(seenPaths);
      const stale = await this.loader.refreshStaleFlags();
      this.state.markConsistent(stale);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Index failed: ${message}`);
      this.state.markError(message);
    }
  }

  private async removeVanished(seenPaths: Set<string>): Promise<void> {
    const known = await this.sourceFiles.listAll();
    for (const row of known) {
      if (!seenPaths.has(row.path)) {
        await this.sourceFiles.remove(row.path);
      }
    }
  }

  private discoverFiles(): Array<{ kind: SourceFileKind; path: string }> {
    const out: Array<{ kind: SourceFileKind; path: string }> = [];
    for (const kind of KINDS) {
      const dir = noesisSubdirPath(this.projectDir, kind);
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        try {
          if (!statSync(full).isFile()) continue;
        } catch {
          continue;
        }
        if (!VALID_EXTENSIONS.has(extname(entry))) continue;
        out.push({ kind, path: full });
      }
    }
    return out;
  }
}
