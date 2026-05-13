import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { assertRoundTimeOrder, type RoundStatus } from "@lottery/domain";
import type { Prisma } from "@prisma/client";
import { AuditLogRepository } from "../audit/audit-log.repository.js";
import { PrismaRepository, type DbClient } from "../store/prisma.repository.js";
import type { RoundRecord } from "../store/records.js";

@Injectable()
export class RoundsService {
  constructor(
    private readonly repo: PrismaRepository,
    private readonly audit: AuditLogRepository
  ) {}

  current(): Promise<RoundRecord | null> {
    return this.repo.currentRound();
  }

  async create(input: { round_code: string; opens_at: string; closes_at: string; draws_at: string; status: RoundStatus }, actorId: string, db: Prisma.TransactionClient): Promise<RoundRecord> {
    try {
      assertRoundTimeOrder(input.opens_at, input.closes_at, input.draws_at);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    const round = await this.repo.createRound(input, actorId, db);
    await this.audit.append({ actor_type: "ADMIN", actor_id: actorId, action: "ROUND_CREATE", resource_type: "rounds", resource_id: round.id, after: round }, db);
    return round;
  }

  async patch(id: string, input: Partial<Pick<RoundRecord, "opens_at" | "closes_at" | "draws_at" | "status">>, actorId: string, db: Prisma.TransactionClient): Promise<RoundRecord> {
    const round = await this.repo.getRound(id, db as DbClient);
    if (!round) {
      throw new NotFoundException("round not found");
    }
    const before = { ...round };
    const next = { ...round, ...input };
    try {
      assertRoundTimeOrder(next.opens_at, next.closes_at, next.draws_at);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    const updated = await this.repo.patchRound(id, input, db);
    await this.audit.append({ actor_type: "ADMIN", actor_id: actorId, action: "ROUND_PATCH", resource_type: "rounds", resource_id: updated.id, before, after: updated }, db);
    return updated;
  }
}
