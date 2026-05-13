import { Injectable } from "@nestjs/common";
import type { BetTypeCatalogEntry, LedgerType, RoundStatus } from "@lottery/domain";
import { Prisma, type BetTypeCatalog, type CreditAccount, type CreditLedger, type ManualUser, type Result, type Round, type SettlementJob } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import type { CreditAccountRecord, CreditLedgerRecord, ManualUserRecord, ResultRecord, RoundRecord, SettlementJobRecord } from "./records.js";

export type DbClient = PrismaService | Prisma.TransactionClient;

function iso(date: Date): string {
  return date.toISOString();
}

function asNumber(value: Prisma.Decimal | number | string): number {
  return Number(value);
}

function asMoney(value: Prisma.Decimal | number | string): number {
  return Number(asNumber(value).toFixed(2));
}

function asJsonObject(value: unknown): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

function mapBetType(entry: BetTypeCatalog): BetTypeCatalogEntry {
  return {
    code: entry.code as BetTypeCatalogEntry["code"],
    display_name: entry.display_name,
    digits: entry.digits,
    outcome_rule: entry.outcome_rule as BetTypeCatalogEntry["outcome_rule"],
    default_odds: entry.default_odds.toFixed(4),
    min_stake: entry.min_stake.toFixed(2),
    max_stake: entry.max_stake.toFixed(2),
    enabled: entry.enabled
  };
}

function mapRound(round: Round): RoundRecord {
  return {
    id: round.id,
    round_code: round.round_code,
    status: round.status as RoundStatus,
    opens_at: iso(round.opens_at),
    closes_at: iso(round.closes_at),
    draws_at: iso(round.draws_at),
    result_6d: round.result_6d,
    paytable_snapshot: round.paytable_snapshot as unknown as BetTypeCatalogEntry[],
    created_at: iso(round.created_at),
    updated_at: iso(round.updated_at)
  };
}

function mapResult(result: Result): ResultRecord {
  return {
    id: result.id,
    round_id: result.round_id,
    result_6d: result.result_6d,
    created_at: iso(result.created_at)
  };
}

function mapSettlementJob(job: SettlementJob): SettlementJobRecord {
  return {
    id: job.id,
    round_id: job.round_id,
    status: job.status as "PENDING",
    created_at: iso(job.created_at)
  };
}

export function mapManualUser(user: ManualUser): ManualUserRecord {
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    password_hash: user.password_hash,
    status: user.status as "ENABLED" | "DISABLED",
    created_at: iso(user.created_at)
  };
}

export function mapCreditAccount(account: CreditAccount): CreditAccountRecord {
  return {
    id: account.id,
    manual_user_id: account.manual_user_id,
    currency: account.currency.trim(),
    balance: asMoney(account.balance),
    version: account.version
  };
}

export function mapCreditLedger(entry: CreditLedger): CreditLedgerRecord {
  return {
    id: entry.id,
    credit_account_id: entry.credit_account_id,
    manual_user_id: entry.manual_user_id,
    type: entry.type as LedgerType,
    amount_delta: asMoney(entry.amount_delta),
    balance_before: asMoney(entry.balance_before),
    balance_after: asMoney(entry.balance_after),
    reason: entry.reason,
    admin_id: entry.admin_id ?? "",
    created_at: iso(entry.created_at)
  };
}

@Injectable()
export class PrismaRepository {
  constructor(private readonly prisma: PrismaService) {}

  client(): PrismaService {
    return this.prisma;
  }

  listEnabledBetTypes(db: DbClient = this.prisma): Promise<BetTypeCatalogEntry[]> {
    return db.betTypeCatalog
      .findMany({ where: { enabled: true }, orderBy: [{ digits: "asc" }, { code: "asc" }] })
      .then((entries) => entries.map(mapBetType));
  }

  async currentRound(db: DbClient = this.prisma): Promise<RoundRecord | null> {
    const now = new Date();
    const round = await db.round.findFirst({
      where: {
        status: "OPEN",
        opens_at: { lte: now },
        closes_at: { gt: now }
      },
      orderBy: { closes_at: "asc" }
    });
    return round ? mapRound(round) : null;
  }

  async createRound(
    input: { round_code: string; opens_at: string; closes_at: string; draws_at: string; status: RoundStatus },
    actorId: string,
    db: DbClient = this.prisma
  ): Promise<RoundRecord> {
    const paytable = await this.listEnabledBetTypes(db);
    const round = await db.round.create({
      data: {
        round_code: input.round_code,
        status: input.status,
        opens_at: new Date(input.opens_at),
        closes_at: new Date(input.closes_at),
        draws_at: new Date(input.draws_at),
        paytable_snapshot: paytable as unknown as Prisma.InputJsonValue,
        created_by_admin_id: actorId
      }
    });
    return mapRound(round);
  }

  async getRound(id: string, db: DbClient = this.prisma): Promise<RoundRecord | null> {
    const round = await db.round.findUnique({ where: { id } });
    return round ? mapRound(round) : null;
  }

  async patchRound(id: string, input: Partial<Pick<RoundRecord, "opens_at" | "closes_at" | "draws_at" | "status">>, db: DbClient = this.prisma): Promise<RoundRecord> {
    const round = await db.round.update({
      where: { id },
      data: {
        ...(input.opens_at ? { opens_at: new Date(input.opens_at) } : {}),
        ...(input.closes_at ? { closes_at: new Date(input.closes_at) } : {}),
        ...(input.draws_at ? { draws_at: new Date(input.draws_at) } : {}),
        ...(input.status ? { status: input.status } : {})
      }
    });
    return mapRound(round);
  }

  async latestResult(db: DbClient = this.prisma): Promise<ResultRecord | null> {
    const result = await db.result.findFirst({ orderBy: { created_at: "desc" } });
    return result ? mapResult(result) : null;
  }

  async createResultAndSettlementJob(
    input: { round_id: string; result_6d: string; result_json: unknown },
    actorId: string,
    db: DbClient = this.prisma
  ): Promise<{ result: ResultRecord; settlement_job: SettlementJobRecord }> {
    const result = await db.result.create({
      data: {
        round_id: input.round_id,
        result_6d: input.result_6d,
        result_json: asJsonObject(input.result_json),
        posted_by_admin_id: actorId
      }
    });
    await db.round.update({
      where: { id: input.round_id },
      data: { result_6d: input.result_6d, status: "RESULT_POSTED", resulted_at: new Date() }
    });
    const settlementJob = await db.settlementJob.create({
      data: {
        round_id: input.round_id,
        payload: { result_id: result.id, result_6d: input.result_6d }
      }
    });
    return { result: mapResult(result), settlement_job: mapSettlementJob(settlementJob) };
  }

  async createManualUserWithAccount(
    input: { username: string; display_name: string; password_hash: string },
    actorId: string,
    db: DbClient = this.prisma
  ): Promise<{ user: ManualUserRecord; credit_account: CreditAccountRecord }> {
    const user = await db.manualUser.create({
      data: {
        username: input.username,
        display_name: input.display_name,
        password_hash: input.password_hash,
        created_by_admin_id: actorId,
        credit_account: { create: { currency: "THB", balance: new Prisma.Decimal(0), version: 1 } }
      },
      include: { credit_account: true }
    });
    return { user: mapManualUser(user), credit_account: mapCreditAccount(user.credit_account!) };
  }

  async lockCreditAccountByManualUserId(manualUserId: string, db: DbClient): Promise<CreditAccountRecord | null> {
    const rows = await db.$queryRaw<
      Array<{ id: string; manual_user_id: string; currency: string; balance: Prisma.Decimal; version: number }>
    >`SELECT id, manual_user_id, currency, balance, version FROM credit_accounts WHERE manual_user_id = CAST(${manualUserId} AS uuid) FOR UPDATE`;
    return rows[0] ? mapCreditAccount(rows[0] as unknown as CreditAccount) : null;
  }

  async getManualUser(id: string, db: DbClient = this.prisma): Promise<ManualUserRecord | null> {
    const user = await db.manualUser.findUnique({ where: { id } });
    return user ? mapManualUser(user) : null;
  }

  async updateCreditAccountBalance(id: string, balance: number, db: DbClient): Promise<CreditAccountRecord> {
    const account = await db.creditAccount.update({
      where: { id },
      data: {
        balance: new Prisma.Decimal(balance),
        version: { increment: 1 }
      }
    });
    return mapCreditAccount(account);
  }

  async countResultsForRound(roundId: string, db: DbClient = this.prisma): Promise<number> {
    return db.result.count({ where: { round_id: roundId } });
  }

  async countSettlementJobsForRound(roundId: string, db: DbClient = this.prisma): Promise<number> {
    return db.settlementJob.count({ where: { round_id: roundId } });
  }
}
