import {
  Body,
  ConflictException,
  Controller,
  Get,
  Param,
  Patch,
} from "@nestjs/common";
import type {
  DesignDocDetailData,
  DesignDocsPageData,
} from "../../ui-contracts/design-docs/design-docs-data.js";
import {
  DesignDocImplementedError,
  DesignDocsService,
  type ElementPathSegment,
} from "./design-docs.service.js";

interface DesignDocElementUpdateBody {
  path: ElementPathSegment[];
  fields: { name?: string; description?: string };
}

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

  @Patch(":designDocId/elements")
  async updateElement(
    @Param("designDocId") designDocId: string,
    @Body() body: DesignDocElementUpdateBody,
  ): Promise<{ ok: true }> {
    if (!Array.isArray(body.path) || body.path.length === 0) {
      throw new Error("Element path must not be empty");
    }
    try {
      return await this.service.updateDesignDocElement(
        designDocId,
        body.path,
        body.fields ?? {},
      );
    } catch (err) {
      if (err instanceof DesignDocImplementedError) {
        throw new ConflictException({
          code: "DESIGN_DOC_IMPLEMENTED",
          design_doc_id: err.designDocId,
          name: err.designDocName,
          message: err.message,
        });
      }
      throw err;
    }
  }
}
