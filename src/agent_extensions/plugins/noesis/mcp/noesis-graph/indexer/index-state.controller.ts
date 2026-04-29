import { Controller, Get } from "@nestjs/common";
import { type IndexState, IndexStateService } from "./index-state.service.js";

@Controller("api/health")
export class IndexStateController {
  constructor(private readonly indexState: IndexStateService) {}

  @Get("index")
  get(): IndexState {
    return this.indexState.get();
  }
}
