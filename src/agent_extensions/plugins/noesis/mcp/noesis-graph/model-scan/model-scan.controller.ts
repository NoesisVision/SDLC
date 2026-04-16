import { Controller, Get, Post } from "@nestjs/common";
import { ModelScanService } from "./model-scan.service.js";
import type { ModelTree } from "./model-scan.types.js";

@Controller("api/model")
export class ModelScanController {
  constructor(private readonly modelScan: ModelScanService) {}

  @Get()
  async getModel(): Promise<ModelTree> {
    return this.modelScan.getModelTree();
  }

  @Post("scan")
  async scan(): Promise<ModelTree> {
    return this.modelScan.scan();
  }
}
