import { Controller, Get, Post } from "@nestjs/common";
import { ScannerService } from "../../scanner/scanner.service.js";
import type { ModelExplorerData } from "./model-explorer-data.js";

@Controller("api/ui/model-explorer")
export class ModelExplorerController {
  constructor(private readonly scanner: ScannerService) {}

  @Get()
  async get(): Promise<ModelExplorerData> {
    return { tree: await this.scanner.getDomainModel() };
  }

  @Post("scan")
  async scan(): Promise<ModelExplorerData> {
    return { tree: await this.scanner.scan() };
  }
}
