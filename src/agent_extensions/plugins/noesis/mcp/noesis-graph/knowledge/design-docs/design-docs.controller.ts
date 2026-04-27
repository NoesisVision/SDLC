import { Controller, Get, Param } from "@nestjs/common";
import type {
  DesignDocDetailData,
  DesignDocsPageData,
} from "../../ui-contracts/design-docs/design-docs-data.js";
import { DesignDocsService } from "./design-docs.service.js";

@Controller("api/ui/design-docs")
export class DesignDocsController {
  constructor(private readonly service: DesignDocsService) {}

  @Get()
  async get(): Promise<DesignDocsPageData> {
    return this.service.getDesignDocsPage();
  }

  @Get(":designDocId")
  async getDetail(
    @Param("designDocId") designDocId: string,
  ): Promise<DesignDocDetailData> {
    return this.service.getDesignDocDetail(designDocId);
  }
}
