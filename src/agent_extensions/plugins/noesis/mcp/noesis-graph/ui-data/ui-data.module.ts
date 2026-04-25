import { Module } from "@nestjs/common";
import { ScannerModule } from "../scanner/scanner.module.js";
import { KnowledgeModule } from "../knowledge/knowledge.module.js";
import { ModelExplorerController } from "./model-explorer/model-explorer.controller.js";
import { InvocationGraphController } from "./invocation-graph/invocation-graph.controller.js";
import { InvocationGraphService } from "./invocation-graph/invocation-graph.service.js";
import { GraphSchemaController } from "./graph-schema/graph-schema.controller.js";

@Module({
  imports: [ScannerModule, KnowledgeModule],
  controllers: [
    ModelExplorerController,
    InvocationGraphController,
    GraphSchemaController,
  ],
  providers: [InvocationGraphService],
})
export class UiDataModule {}
