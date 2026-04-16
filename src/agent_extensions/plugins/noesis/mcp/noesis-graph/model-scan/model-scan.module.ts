import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { SerenaModule } from "../serena/serena.module.js";
import { ModelScanService } from "./model-scan.service.js";
import { ModelScanRepository } from "./model-scan.repository.js";
import { ModelScanController } from "./model-scan.controller.js";

@Module({
  imports: [DatabaseModule, SerenaModule],
  controllers: [ModelScanController],
  providers: [ModelScanService, ModelScanRepository],
  exports: [ModelScanService],
})
export class ModelScanModule {}
