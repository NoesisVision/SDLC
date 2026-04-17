import { Controller, Get, Post } from "@nestjs/common";
import { ScannerService } from "./scanner.service.js";
import type { ModelTree } from "./scanner.types.js";

@Controller("api/model")
export class ScannerController {
  constructor(private readonly scanner: ScannerService) {}

  @Get()
  async getModel(): Promise<ModelTree> {
    return this.scanner.getModelTree();
  }

  @Post("scan")
  async scan(): Promise<ModelTree> {
    return this.scanner.scan();
  }
}
