import { Controller, Get, Post } from "@nestjs/common";
import { ScannerService } from "./scanner.service.js";
import type { DomainModelTree } from "./scanner.types.js";

@Controller("api/model")
export class ScannerController {
  constructor(private readonly scanner: ScannerService) {}

  @Get()
  async getModel(): Promise<DomainModelTree> {
    return this.scanner.getDomainModel();
  }

  @Post("scan")
  async scan(): Promise<DomainModelTree> {
    return this.scanner.scan();
  }
}
