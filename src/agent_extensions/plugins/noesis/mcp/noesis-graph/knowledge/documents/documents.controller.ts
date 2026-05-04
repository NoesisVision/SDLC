import { Controller, Get, Param } from "@nestjs/common";
import type {
  DocumentDetailData,
  DocumentsPageData,
} from "../../ui-contracts/documents/documents-data.js";
import { DocumentsService } from "./documents.service.js";

@Controller("api/ui/documents")
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  async get(): Promise<DocumentsPageData> {
    return this.documents.getDocumentsPage();
  }

  @Get(":documentId")
  async getDetail(
    @Param("documentId") documentId: string,
  ): Promise<DocumentDetailData> {
    return this.documents.getDocumentDetail(documentId);
  }
}
