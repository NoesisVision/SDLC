import { Module, type DynamicModule } from "@nestjs/common";
import { ServeStaticModule } from "@nestjs/serve-static";
import { resolve } from "path";
import { ConfigModule } from "./config/config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { IndexerModule } from "./indexer/indexer.module.js";
import { SerenaModule } from "./serena/serena.module.js";
import { ScannerModule } from "./scanner/scanner.module.js";
import { KnowledgeModule } from "./knowledge/knowledge.module.js";
import { HealthController } from "./health/health.controller.js";

@Module({})
export class AppModule {
  static forRoot(dataDir: string, projectDir: string): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(dataDir, projectDir),
        ServeStaticModule.forRoot({
          rootPath: resolve(import.meta.dirname, "ui/dist"),
          exclude: ["/api/{*path}"],
        }),
        DatabaseModule,
        IndexerModule,
        SerenaModule,
        ScannerModule,
        KnowledgeModule,
      ],
      controllers: [HealthController],
    };
  }
}
