import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { ScannerService } from "./scanner.service.js";
import { ScannerRepository } from "./scanner.repository.js";
import { ScannerController } from "./scanner.controller.js";

@Module({
  imports: [DatabaseModule],
  controllers: [ScannerController],
  providers: [ScannerService, ScannerRepository],
  exports: [ScannerService],
})
export class ScannerModule {}
