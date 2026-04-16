import { Controller, Get } from "@nestjs/common";

@Controller("api")
export class HealthController {
  @Get("health")
  check(): { status: string } {
    return { status: "ok" };
  }
}
