import { Module } from "@nestjs/common";
import { SerenaService } from "./serena.service.js";
import { SerenaController } from "./serena.controller.js";

@Module({
  controllers: [SerenaController],
  providers: [SerenaService],
  exports: [SerenaService],
})
export class SerenaModule {}
