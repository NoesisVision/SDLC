import {
  Body,
  ConflictException,
  Controller,
  Get,
  Param,
  Patch,
  Put,
} from "@nestjs/common";
import type { DesignedActor } from "../../../../shared-contracts/design-doc.js";
import type {
  DesignDocDetailData,
  DesignDocsPageData,
} from "../../ui-contracts/design-docs/design-docs-data.js";
import {
  DesignDocImplementedError,
  DesignDocsService,
  type ElementPathSegment,
  type ElementUpdateFields,
} from "./design-docs.service.js";

interface DesignDocElementUpdateBody {
  path: ElementPathSegment[];
  fields: ElementUpdateFields;
}

interface ActorUpsertBody {
  description?: string | null;
}

@Controller("api/ui")
export class DesignDocsController {
  constructor(private readonly service: DesignDocsService) {}

  @Get("design-docs")
  async get(): Promise<DesignDocsPageData> {
    return this.service.getDesignDocsPage();
  }

  @Get("design-docs/:designDocId")
  async getDetail(
    @Param("designDocId") designDocId: string,
  ): Promise<DesignDocDetailData> {
    return this.service.getDesignDocDetail(designDocId);
  }

  @Patch("design-docs/:designDocId/elements")
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

  @Get("actors")
  async listActors(): Promise<{ actors: DesignedActor[] }> {
    return { actors: await this.service.listActors() };
  }

  @Put("actors/:name")
  async upsertActor(
    @Param("name") name: string,
    @Body() body: ActorUpsertBody,
  ): Promise<{ status: "Ok"; name: string }> {
    return this.service.upsertActor({
      name,
      description: body.description ?? null,
    });
  }
}
