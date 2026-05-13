import { Injectable } from "@nestjs/common";
import { redact } from "../common/redacted-logger.js";
import { PrismaRepository, type DbClient } from "../store/prisma.repository.js";
import type { AuditLogRecord } from "../store/records.js";

function iso(date: Date): string {
  return date.toISOString();
}

@Injectable()
export class AuditLogRepository {
  constructor(private readonly repo: PrismaRepository) {}

  async append(input: Omit<AuditLogRecord, "id" | "created_at" | "before" | "after"> & { before?: unknown; after?: unknown }, db: DbClient = this.repo.client()): Promise<AuditLogRecord> {
    const record = await db.auditLog.create({
      data: {
        actor_type: input.actor_type,
        actor_id: input.actor_id,
        action: input.action,
        resource_type: input.resource_type,
        resource_id: input.resource_id,
        before: redact(input.before) as object,
        after: redact(input.after) as object
      }
    });
    return {
      id: record.id,
      actor_type: record.actor_type,
      actor_id: record.actor_id,
      action: record.action,
      resource_type: record.resource_type,
      resource_id: record.resource_id,
      before: record.before,
      after: record.after,
      created_at: iso(record.created_at)
    };
  }

  async list(db: DbClient = this.repo.client()): Promise<AuditLogRecord[]> {
    const records = await db.auditLog.findMany({ orderBy: { created_at: "asc" } });
    return records.map((record) => ({
      id: record.id,
      actor_type: record.actor_type,
      actor_id: record.actor_id,
      action: record.action,
      resource_type: record.resource_type,
      resource_id: record.resource_id,
      before: record.before,
      after: record.after,
      created_at: iso(record.created_at)
    }));
  }
}
