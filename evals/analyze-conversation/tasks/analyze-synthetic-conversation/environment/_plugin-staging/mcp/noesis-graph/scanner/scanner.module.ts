import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { SerenaModule } from "../serena/serena.module.js";
import { ModelExplorerController } from "./scanner.controller.js";
import { ScannerService } from "./scanner.service.js";
import { ScannerRepository } from "./scanner.repository.js";
import { InvocationGraphController } from "./invocations/invocations.controller.js";
import { InvocationsRepository } from "./invocations/invocations.repository.js";
import { InvocationsService } from "./invocations/invocations.service.js";

@Module({
  imports: [DatabaseModule, SerenaModule],
  controllers: [ModelExplorerController, InvocationGraphController],
  providers: [
    ScannerService,
    ScannerRepository,
    InvocationsRepository,
    InvocationsService,
  ],
  exports: [ScannerService, InvocationsService],
})
export class ScannerModule {}
