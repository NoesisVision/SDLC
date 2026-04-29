import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from "@nestjs/common";
import { type FSWatcher, watch } from "fs";
import {
  ensureNoesisLayout,
  noesisRoot,
} from "../../../shared-contracts/source-files.js";
import { PROJECT_DIR } from "../config/config.module.js";
import { IndexerService } from "./indexer.service.js";

const DEFAULT_DEBOUNCE_MS = 250;

@Injectable()
export class FileWatcherService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(FileWatcherService.name);
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceMs = DEFAULT_DEBOUNCE_MS;
  private autoStart = true;

  constructor(
    @Inject(PROJECT_DIR) private readonly projectDir: string,
    private readonly indexer: IndexerService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.autoStart) return;
    await this.indexer.runFullIndex();
    this.start();
  }

  disableAutoStart(): void {
    this.autoStart = false;
  }

  start(): void {
    if (this.watcher !== null) return;
    ensureNoesisLayout(this.projectDir);
    const root = noesisRoot(this.projectDir);
    this.watcher = watch(root, { recursive: true }, () => {
      this.scheduleReindex();
    });
    this.logger.log(`Watching ${root}`);
  }

  setDebounceMs(ms: number): void {
    this.debounceMs = ms;
  }

  onModuleDestroy(): void {
    this.stop();
  }

  stop(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher !== null) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  private scheduleReindex(): void {
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.indexer.runFullIndex().catch((err) => {
        this.logger.error(`Re-index failed: ${(err as Error).message}`);
      });
    }, this.debounceMs);
  }
}
