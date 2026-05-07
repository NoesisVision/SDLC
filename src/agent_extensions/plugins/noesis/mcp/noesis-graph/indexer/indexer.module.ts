import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { FileSyncService } from "../file-sync/file-sync.service.js";
import { SourceFilesRepository } from "../file-sync/source-files.repository.js";
import { DesignDocsRepository } from "../knowledge/design-docs/design-docs.repository.js";
import { FileWatcherService } from "./file-watcher.service.js";
import { IndexStateController } from "./index-state.controller.js";
import { IndexStateService } from "./index-state.service.js";
import { IndexerService } from "./indexer.service.js";

@Module({
  imports: [DatabaseModule],
  controllers: [IndexStateController],
  providers: [
    IndexStateService,
    IndexerService,
    FileWatcherService,
    SourceFilesRepository,
    FileSyncService,
    DesignDocsRepository,
  ],
  exports: [
    IndexStateService,
    IndexerService,
    FileWatcherService,
    FileSyncService,
    DesignDocsRepository,
  ],
})
export class IndexerModule {}
