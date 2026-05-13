import { Controller, Get } from "@nestjs/common";
import { loadConfig } from "../config/config.js";

@Controller("/api")
export class HealthController {
  @Get("/health")
  health() {
    return { ok: true, service: "lottery-api", mode: loadConfig().mode };
  }
}
