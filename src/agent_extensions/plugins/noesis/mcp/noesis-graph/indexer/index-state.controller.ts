import { Controller, Get } from "@nestjs/common";
import { IndexerService, type IndexState } from "./indexer.service.js";

@Controller("api/health")
export class IndexStateController {
  constructor(private readonly indexer: IndexerService) {}

  @Get("index")
  get(): IndexState {
    return this.indexer.getState();
  }
}
