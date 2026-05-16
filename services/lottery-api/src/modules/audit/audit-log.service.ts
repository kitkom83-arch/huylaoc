import { BadRequestException, Injectable } from "@nestjs/common";
import { AuditLogRepository, type AuditLogListFilters, type AuditLogListItem } from "./audit-log.repository.js";

type AuditLogQuery = AuditLogListFilters & {
  limit?: string;
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parseLimit(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_LIMIT;
  }
  if (!/^\d+$/.test(value)) {
    throw new BadRequestException("limit must be an integer between 1 and 100");
  }
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new BadRequestException("limit must be an integer between 1 and 100");
  }
  return limit;
}

@Injectable()
export class AuditLogService {
  constructor(private readonly auditLogs: AuditLogRepository) {}

  async list(query: AuditLogQuery): Promise<{ items: AuditLogListItem[]; limit: number }> {
    const limit = parseLimit(query.limit);
    const items = await this.auditLogs.listForAdminRead({
      limit,
      filters: {
        actor_type: query.actor_type,
        actor_id: query.actor_id,
        action: query.action,
        object_type: query.object_type,
        object_id: query.object_id,
        request_id: query.request_id
      }
    });
    return { items, limit };
  }
}
