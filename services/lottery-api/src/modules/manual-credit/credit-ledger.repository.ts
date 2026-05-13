import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { mapCreditLedger, PrismaRepository, type DbClient } from "../store/prisma.repository.js";
import type { CreditLedgerRecord } from "../store/records.js";

type CreditLedgerAppendType = Exclude<CreditLedgerRecord["type"], "PAYOUT_CREDIT">;

function toPrismaLedgerType(type: CreditLedgerRecord["type"]): CreditLedgerAppendType {
  if (type === "PAYOUT_CREDIT") {
    throw new Error("PAYOUT_CREDIT is created by the settlement worker");
  }
  return type;
}

@Injectable()
export class CreditLedgerRepository {
  constructor(private readonly repo: PrismaRepository) {}

  async append(input: Omit<CreditLedgerRecord, "id" | "created_at">, db: DbClient = this.repo.client()): Promise<CreditLedgerRecord> {
    const record = await db.creditLedger.create({
      data: {
        credit_account_id: input.credit_account_id,
        manual_user_id: input.manual_user_id,
        type: toPrismaLedgerType(input.type),
        amount_delta: new Prisma.Decimal(input.amount_delta),
        balance_before: new Prisma.Decimal(input.balance_before),
        balance_after: new Prisma.Decimal(input.balance_after),
        reason: input.reason,
        admin_id: input.admin_id,
        metadata: {}
      }
    });
    return mapCreditLedger(record);
  }

  async list(db: DbClient = this.repo.client()): Promise<CreditLedgerRecord[]> {
    const records = await db.creditLedger.findMany({ orderBy: { created_at: "asc" } });
    return records.map(mapCreditLedger);
  }
}
