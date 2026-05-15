import { Controller, Get } from "@nestjs/common";
import { OpsService } from "./ops.service.js";

@Controller("/v1/admin/ops")
export class OpsController {
  constructor(private readonly ops: OpsService) {}

  @Get("/wallet-outbox/summary")
  walletOutboxSummary() {
    return this.ops.walletOutboxSummary();
  }

  @Get("/settlement-jobs/summary")
  settlementJobsSummary() {
    return this.ops.settlementJobsSummary();
  }

  @Get("/worker/last-run")
  workerLastRun() {
    return this.ops.workerLastRun();
  }
}
