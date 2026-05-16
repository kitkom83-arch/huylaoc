import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { redact } from "../common/redacted-logger.js";
import { PrismaRepository, type DbClient } from "../store/prisma.repository.js";
import type { AuditLogRecord } from "../store/records.js";

export type AuditLogListFilters = {
  actor_type?: string;
  actor_id?: string;
  action?: string;
  object_type?: string;
  object_id?: string;
  request_id?: string;
};

export type AuditLogListItem = {
  id: string;
  actor_type: string;
  actor_id: string;
  action: string;
  object_type: string;
  object_id: string;
  request_id: string | null;
  idempotency_key: string | null;
  created_at: string;
};

function iso(date: Date): string {
  return date.toISOString();
}

function jsonObject(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
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

  async listForAdminRead(input: { limit: number; filters: AuditLogListFilters }, db: DbClient = this.repo.client()): Promise<AuditLogListItem[]> {
    const where: Prisma.AuditLogWhereInput = {
      ...(input.filters.actor_type ? { actor_type: input.filters.actor_type } : {}),
      ...(input.filters.actor_id ? { actor_id: input.filters.actor_id } : {}),
      ...(input.filters.action ? { action: input.filters.action } : {}),
      ...(input.filters.object_type ? { resource_type: input.filters.object_type } : {}),
      ...(input.filters.object_id ? { resource_id: input.filters.object_id } : {})
    };

    if (input.filters.request_id) {
      where.OR = [
        { before: { path: ["request_id"], equals: input.filters.request_id } },
        { after: { path: ["request_id"], equals: input.filters.request_id } }
      ];
    }

    const records = await db.auditLog.findMany({
      where,
      orderBy: { created_at: "desc" },
      take: input.limit,
      select: {
        id: true,
        actor_type: true,
        actor_id: true,
        action: true,
        resource_type: true,
        resource_id: true,
        before: true,
        after: true,
        created_at: true
      }
    });

    return records.map((record) => {
      const before = jsonObject(record.before);
      const after = jsonObject(record.after);
      return {
        id: record.id,
        actor_type: record.actor_type,
        actor_id: record.actor_id,
        action: record.action,
        object_type: record.resource_type,
        object_id: record.resource_id,
        request_id: optionalString(after.request_id) ?? optionalString(before.request_id),
        idempotency_key: optionalString(after.idempotency_key) ?? optionalString(before.idempotency_key),
        created_at: iso(record.created_at)
      };
    });
  }
}
