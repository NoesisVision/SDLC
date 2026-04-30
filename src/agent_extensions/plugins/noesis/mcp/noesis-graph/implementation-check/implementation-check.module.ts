import { Module } from "@nestjs/common";
import { DesignDocsModule } from "../knowledge/design-docs/design-docs.module.js";
import { ScannerModule } from "../scanner/scanner.module.js";
import { ImplementationCheckService } from "./implementation-check.service.js";

@Module({
  imports: [ScannerModule, DesignDocsModule],
  providers: [ImplementationCheckService],
  exports: [ImplementationCheckService],
})
export class ImplementationCheckModule {}
