import { Controller, Get, Post } from "@nestjs/common";
import type { ModelExplorerData } from "../ui-contracts/model-explorer/model-explorer-data.js";
import { ScannerService } from "./scanner.service.js";

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
