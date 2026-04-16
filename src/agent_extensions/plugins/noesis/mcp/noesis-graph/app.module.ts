import { Module } from "@nestjs/common";
import { ServeStaticModule } from "@nestjs/serve-static";
import { resolve } from "path";
import { ConfigModule } from "./config/config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { SerenaModule } from "./serena/serena.module.js";
import { HealthController } from "./health/health.controller.js";

@Module({
  imports: [
    ConfigModule.forRoot(process.env["CLAUDE_PLUGIN_DATA"] ?? ""),
    ServeStaticModule.forRoot({
      rootPath: resolve(import.meta.dirname, "ui/dist"),
      exclude: ["/api/(.*)"],
    }),
    DatabaseModule,
    SerenaModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
