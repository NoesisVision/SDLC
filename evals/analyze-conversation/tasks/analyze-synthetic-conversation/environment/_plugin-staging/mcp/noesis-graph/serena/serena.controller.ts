import { Controller, Get } from "@nestjs/common";
import { SerenaService, type SerenaState } from "./serena.service.js";

@Controller("api/serena")
export class SerenaController {
  constructor(private readonly serena: SerenaService) {}

  @Get("status")
  getStatus(): SerenaState {
    return this.serena.getState();
  }
}
