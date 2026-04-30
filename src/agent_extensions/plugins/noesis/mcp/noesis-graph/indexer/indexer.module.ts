import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { FileLoaderService } from "../file-sync/file-loader.service.js";
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
    FileLoaderService,
    DesignDocsRepository,
  ],
  exports: [
    IndexStateService,
    IndexerService,
    FileWatcherService,
    FileLoaderService,
    DesignDocsRepository,
  ],
})
export class IndexerModule {}
