import { Controller, Get, Query } from "@nestjs/common";
import { AuditLogService } from "./audit-log.service.js";

@Controller("/v1/admin/audit-logs")
export class AuditLogController {
  constructor(private readonly auditLogs: AuditLogService) {}

  @Get()
  list(@Query() query: Record<string, string | undefined>) {
    return this.auditLogs.list(query);
  }
}
