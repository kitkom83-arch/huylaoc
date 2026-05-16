import { Injectable, NotFoundException } from "@nestjs/common";
import { deriveOutcomes } from "@lottery/rules";
import type { Prisma } from "@prisma/client";
import { AuditLogRepository } from "../audit/audit-log.repository.js";
import { PrismaRepository } from "../store/prisma.repository.js";

type SettlementSummary = {
  scanned_count: number;
  claimed_count: number;
  processed_count: number;
  succeeded_count: number;
  failed_count: number;
  unknown_count: number;
  retried_count: number;
  skipped_count: number;
  stale_recovered_count: number;
};

type SettlementJobResponse = {
  settlement_job_id: string;
  round_id: string;
  status: string;
  progress_total: number;
  progress_done: number;
  winners_found: number;
  payouts_succeeded: number;
  payouts_failed: number;
  summary: SettlementSummary;
  created_at: string;
  updated_at: string;
};

function jsonObject(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numericPayloadValue(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function iso(date: Date): string {
  return date.toISOString();
}

@Injectable()
export class ResultsService {
  constructor(
    private readonly repo: PrismaRepository,
    private readonly audit: AuditLogRepository
  ) {}

  async latest() {
    const result = await this.repo.latestResult();
    return result ? { ...result, outcomes: deriveOutcomes(result.result_6d) } : null;
  }

  async post(input: { round_id: string; result_6d: string }, actorId: string, db: Prisma.TransactionClient) {
    const round = await this.repo.getRound(input.round_id, db);
    if (!round) {
      throw new NotFoundException("round not found");
    }
    const outcomes = deriveOutcomes(input.result_6d);
    const { result, settlement_job } = await this.repo.createResultAndSettlementJob(
      { round_id: round.id, result_6d: input.result_6d, result_json: outcomes },
      actorId,
      db
    );
    await this.audit.append({
      actor_type: "ADMIN",
      actor_id: actorId,
      action: "RESULT_POST",
      resource_type: "rounds",
      resource_id: round.id,
      after: { result, settlement_job }
    }, db);
    return { result: { ...result, outcomes: deriveOutcomes(result.result_6d) }, settlement_job };
  }

  async getSettlementJob(jobId: string): Promise<SettlementJobResponse> {
    const job = await this.repo.client().settlementJob.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException("settlement job not found");
    }

    const payload = jsonObject(job.payload);
    return {
      settlement_job_id: job.id,
      round_id: job.round_id,
      status: job.status,
      progress_total: numericPayloadValue(payload, "tickets_total"),
      progress_done: numericPayloadValue(payload, "tickets_done"),
      winners_found: numericPayloadValue(payload, "winners_found"),
      payouts_succeeded: numericPayloadValue(payload, "payouts_succeeded"),
      payouts_failed: numericPayloadValue(payload, "payouts_failed"),
      summary: {
        scanned_count: numericPayloadValue(payload, "scanned_count"),
        claimed_count: numericPayloadValue(payload, "claimed_count"),
        processed_count: numericPayloadValue(payload, "processed_count"),
        succeeded_count: numericPayloadValue(payload, "succeeded_count"),
        failed_count: numericPayloadValue(payload, "failed_count"),
        unknown_count: numericPayloadValue(payload, "unknown_count"),
        retried_count: numericPayloadValue(payload, "retried_count"),
        skipped_count: numericPayloadValue(payload, "skipped_count"),
        stale_recovered_count: numericPayloadValue(payload, "stale_recovered_count")
      },
      created_at: iso(job.created_at),
      updated_at: iso(job.updated_at)
    };
  }
}
