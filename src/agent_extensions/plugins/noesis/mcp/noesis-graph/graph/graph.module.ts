import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { GraphService } from "./graph.service.js";
import { GraphController } from "./graph.controller.js";

@Module({
  imports: [DatabaseModule],
  controllers: [GraphController],
  providers: [GraphService],
})
export class GraphModule {}
