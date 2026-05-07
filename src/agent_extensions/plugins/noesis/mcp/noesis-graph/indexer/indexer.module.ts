import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { FileSyncService } from "../file-sync/file-sync.service.js";
import { GraphProjectionService } from "../file-sync/graph-projection.service.js";
import { SourceFilesRepository } from "../file-sync/source-files.repository.js";
import { StalenessService } from "../file-sync/staleness.service.js";
import { DesignDocsRepository } from "../knowledge/design-docs/design-docs.repository.js";
import { FileWatcherService } from "./file-watcher.service.js";
import { IndexStateController } from "./index-state.controller.js";
import { IndexerService } from "./indexer.service.js";

@Module({
  imports: [DatabaseModule],
  controllers: [IndexStateController],
  providers: [
    IndexerService,
    FileWatcherService,
    SourceFilesRepository,
    FileSyncService,
    GraphProjectionService,
    StalenessService,
    DesignDocsRepository,
  ],
  exports: [
    IndexerService,
    FileWatcherService,
    FileSyncService,
    GraphProjectionService,
    StalenessService,
    DesignDocsRepository,
  ],
})
export class IndexerModule {}
