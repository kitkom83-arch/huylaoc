import { Injectable, NotFoundException } from "@nestjs/common";
import { deriveOutcomes } from "@lottery/rules";
import type { Prisma } from "@prisma/client";
import { AuditLogRepository } from "../audit/audit-log.repository.js";
import { PrismaRepository } from "../store/prisma.repository.js";

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
}
