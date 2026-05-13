import { randomUUID } from "node:crypto";
import { betTypeCodes, betTypeDigits, result6dSchema, type BetTypeCode } from "@lottery/domain";
import { Prisma, PrismaClient, type SettlementJob, type Ticket, type TicketItem } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;
type SettlementJobStatus = "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED";
type TicketWithItems = Ticket & { items: TicketItem[] };

export interface SettlementPreflightReport {
  settlement_job_id: string;
  round_id: string;
  eligible_count: number;
  skipped_count: number;
  ticket_count: number;
}

export interface SettlementRunReport {
  settlement_job_id: string;
  round_id: string;
  status: SettlementJobStatus;
  tickets_total: number;
  tickets_done: number;
  winners_found: number;
  payouts_succeeded: number;
  payouts_failed: number;
  skipped_count: number;
}

const manualEligibleFundingStatuses = ["DEBITED", "SUCCEEDED", "NOT_REQUIRED"] as const;

function money(value: number): number {
  return Number(value.toFixed(2));
}

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(2));
}

function isBetTypeCode(value: string): value is BetTypeCode {
  return (betTypeCodes as readonly string[]).includes(value);
}

function matchStraightBet(code: BetTypeCode, number: string, result6d: string): boolean {
  const digits = betTypeDigits[code];
  return new RegExp(`^\\d{${digits}}$`).test(number) && number === result6d.slice(-digits);
}

function reportFromJob(job: SettlementJob): SettlementRunReport {
  const payload = typeof job.payload === "object" && job.payload !== null && !Array.isArray(job.payload) ? job.payload as Record<string, unknown> : {};
  return {
    settlement_job_id: job.id,
    round_id: job.round_id,
    status: job.status as SettlementJobStatus,
    tickets_total: typeof payload.tickets_total === "number" ? payload.tickets_total : 0,
    tickets_done: typeof payload.tickets_done === "number" ? payload.tickets_done : 0,
    winners_found: typeof payload.winners_found === "number" ? payload.winners_found : 0,
    payouts_succeeded: typeof payload.payouts_succeeded === "number" ? payload.payouts_succeeded : 0,
    payouts_failed: typeof payload.payouts_failed === "number" ? payload.payouts_failed : 0,
    skipped_count: typeof payload.skipped_count === "number" ? payload.skipped_count : 0
  };
}

async function loadResult6d(db: DbClient, job: SettlementJob): Promise<string> {
  const payload = typeof job.payload === "object" && job.payload !== null && !Array.isArray(job.payload) ? job.payload as Record<string, unknown> : {};
  if (typeof payload.result_6d === "string") {
    return payload.result_6d;
  }

  const result = await db.result.findFirst({
    where: { round_id: job.round_id },
    orderBy: { created_at: "desc" },
    select: { result_6d: true }
  });
  if (!result) {
    throw new Error("settlement result not found");
  }
  return result.result_6d;
}

function isEligibleTicket(ticket: TicketWithItems, succeededWalletDebitTicketIds: Set<string>): boolean {
  if (ticket.status !== "CONFIRMED" || ticket.settlement_status !== "PENDING") {
    return false;
  }

  if (ticket.mode === "MANUAL_CREDIT") {
    return manualEligibleFundingStatuses.some((status) => status === ticket.funding_status);
  }

  return ticket.mode === "EXTERNAL_WALLET" && succeededWalletDebitTicketIds.has(ticket.id);
}

async function loadEligibleTickets(db: DbClient, roundId: string): Promise<{ eligibleTickets: TicketWithItems[]; ticketCount: number }> {
  const tickets = await db.ticket.findMany({
    where: {
      round_id: roundId,
      status: "CONFIRMED",
      settlement_status: "PENDING"
    },
    include: { items: { orderBy: { line_no: "asc" } } },
    orderBy: { created_at: "asc" }
  });
  const walletDebitRows = await db.walletOutbox.findMany({
    where: {
      ticket_id: { in: tickets.filter((ticket) => ticket.mode === "EXTERNAL_WALLET").map((ticket) => ticket.id) },
      type: "WALLET_DEBIT",
      status: "SUCCEEDED"
    },
    select: { ticket_id: true }
  });
  const succeededWalletDebitTicketIds = new Set(walletDebitRows.flatMap((row) => row.ticket_id ? [row.ticket_id] : []));

  return {
    eligibleTickets: tickets.filter((ticket) => isEligibleTicket(ticket, succeededWalletDebitTicketIds)),
    ticketCount: await db.ticket.count({ where: { round_id: roundId } })
  };
}

async function lockSettlementJob(db: DbClient, settlementJobId?: string): Promise<SettlementJob> {
  const rows = settlementJobId
    ? await db.$queryRaw<Array<SettlementJob>>`
        SELECT * FROM settlement_jobs WHERE id = CAST(${settlementJobId} AS uuid) FOR UPDATE
      `
    : await db.$queryRaw<Array<SettlementJob>>`
        SELECT * FROM settlement_jobs WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED
      `;
  const job = rows[0];
  if (!job) {
    throw new Error(settlementJobId ? "settlement job not found" : "queued settlement job not found");
  }
  return job;
}

async function creditManualPayout(db: Prisma.TransactionClient, ticket: Ticket, payoutTotal: number, settlementJobId: string): Promise<void> {
  if (!ticket.manual_user_id) {
    throw new Error("manual ticket has no manual user");
  }

  const accounts = await db.$queryRaw<Array<{ id: string; manual_user_id: string; balance: Prisma.Decimal }>>`
    SELECT id, manual_user_id, balance FROM credit_accounts WHERE manual_user_id = CAST(${ticket.manual_user_id} AS uuid) FOR UPDATE
  `;
  const account = accounts[0];
  if (!account) {
    throw new Error("credit account not found");
  }

  const balanceBefore = money(Number(account.balance));
  const balanceAfter = money(balanceBefore + payoutTotal);
  const metadata = {
    ticket_id: ticket.id,
    ticket_no: ticket.ticket_no,
    settlement_job_id: settlementJobId
  };

  await db.$executeRaw`
    INSERT INTO credit_ledger (
      id,
      credit_account_id,
      manual_user_id,
      type,
      amount_delta,
      balance_before,
      balance_after,
      reason,
      admin_id,
      metadata
    )
    VALUES (
      CAST(${randomUUID()} AS uuid),
      CAST(${account.id} AS uuid),
      CAST(${ticket.manual_user_id} AS uuid),
      CAST(${"PAYOUT_CREDIT"} AS ledger_type),
      ${decimal(payoutTotal)},
      ${decimal(balanceBefore)},
      ${decimal(balanceAfter)},
      ${`ticket payout ${ticket.ticket_no}`},
      ${"settlement-worker"},
      CAST(${JSON.stringify(metadata)} AS jsonb)
    )
  `;
  await db.creditAccount.update({
    where: { id: account.id },
    data: {
      balance: decimal(balanceAfter),
      version: { increment: 1 }
    }
  });
}

async function enqueueWalletPayout(db: Prisma.TransactionClient, ticket: Ticket, payoutTotal: number, settlementJobId: string): Promise<void> {
  await db.walletOutbox.create({
    data: {
      type: "WALLET_CREDIT",
      status: "PENDING",
      ticket_id: ticket.id,
      wallet_account_ref: ticket.wallet_account_ref,
      external_txn_ref: ticket.external_txn_ref,
      payload: {
        ticket_no: ticket.ticket_no,
        payout_total: payoutTotal,
        currency_code: "THB",
        settlement_job_id: settlementJobId
      } as Prisma.InputJsonValue
    }
  });
}

async function settleTicket(db: Prisma.TransactionClient, ticket: TicketWithItems, result6d: string, settlementJobId: string): Promise<{ won: boolean; payoutSucceeded: boolean; payoutFailed: boolean }> {
  let payoutTotal = 0;
  for (const item of ticket.items) {
    const won = isBetTypeCode(item.bet_type_code) && matchStraightBet(item.bet_type_code, item.number, result6d);
    const payoutAmount = won ? money(Number(item.potential_payout)) : 0;
    payoutTotal = money(payoutTotal + payoutAmount);
    await db.ticketItem.update({
      where: { id: item.id },
      data: {
        win_status: won ? "WON" : "LOST",
        payout_amount: decimal(payoutAmount)
      }
    });
  }

  const won = payoutTotal > 0;
  let payoutStatus: "NO_WIN" | "PENDING" | "SUCCEEDED" | "FAILED" = won ? "PENDING" : "NO_WIN";
  let payoutSucceeded = false;
  let payoutFailed = false;

  if (won && ticket.mode === "MANUAL_CREDIT") {
    try {
      await creditManualPayout(db, ticket, payoutTotal, settlementJobId);
      payoutStatus = "SUCCEEDED";
      payoutSucceeded = true;
    } catch (error) {
      payoutStatus = "FAILED";
      payoutFailed = true;
    }
  }

  if (won && ticket.mode === "EXTERNAL_WALLET") {
    await enqueueWalletPayout(db, ticket, payoutTotal, settlementJobId);
  }

  await db.$executeRaw`
    UPDATE tickets
    SET
      status = 'SETTLED',
      settlement_status = ${won ? "WON" : "LOST"},
      payout_status = CAST(${payoutStatus} AS payout_status),
      actual_payout_total = ${decimal(payoutTotal)},
      updated_at = now()
    WHERE id = CAST(${ticket.id} AS uuid)
  `;

  return { won, payoutSucceeded, payoutFailed };
}

export class SettlementWorkerService {
  constructor(private readonly prisma: PrismaClient = new PrismaClient()) {}

  disconnect(): Promise<void> {
    return this.prisma.$disconnect();
  }

  settleQueuedJob(): Promise<SettlementRunReport> {
    return this.settleSettlementJob();
  }

  async settleSettlementJob(settlementJobId?: string): Promise<SettlementRunReport> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const job = await lockSettlementJob(tx, settlementJobId);
        if (job.status === "SUCCEEDED") {
          return reportFromJob(job);
        }

        await tx.settlementJob.update({ where: { id: job.id }, data: { status: "PROCESSING" } });

        const result6d = await loadResult6d(tx, job);
        result6dSchema.parse(result6d);
        const { eligibleTickets, ticketCount } = await loadEligibleTickets(tx, job.round_id);
        const report: SettlementRunReport = {
          settlement_job_id: job.id,
          round_id: job.round_id,
          status: "SUCCEEDED",
          tickets_total: eligibleTickets.length,
          tickets_done: 0,
          winners_found: 0,
          payouts_succeeded: 0,
          payouts_failed: 0,
          skipped_count: ticketCount - eligibleTickets.length
        };

        for (const ticket of eligibleTickets) {
          const settled = await settleTicket(tx, ticket, result6d, job.id);
          report.tickets_done += 1;
          report.winners_found += settled.won ? 1 : 0;
          report.payouts_succeeded += settled.payoutSucceeded ? 1 : 0;
          report.payouts_failed += settled.payoutFailed ? 1 : 0;
        }

        report.status = report.payouts_failed > 0 ? "FAILED" : "SUCCEEDED";
        await tx.settlementJob.update({
          where: { id: job.id },
          data: {
            status: report.status,
            payload: {
              ...job.payload as Prisma.JsonObject,
              result_6d: result6d,
              tickets_total: report.tickets_total,
              tickets_done: report.tickets_done,
              winners_found: report.winners_found,
              payouts_succeeded: report.payouts_succeeded,
              payouts_failed: report.payouts_failed,
              skipped_count: report.skipped_count
            }
          }
        });
        return report;
      });
    } catch (error) {
      if (settlementJobId) {
        await this.prisma.settlementJob.update({
          where: { id: settlementJobId },
          data: {
            status: "FAILED",
            payload: {
              error: error instanceof Error ? error.message : "settlement failed"
            }
          }
        }).catch(() => undefined);
      }
      throw error;
    }
  }
}

export class SettlementPreflightService {
  constructor(private readonly prisma: PrismaClient = new PrismaClient()) {}

  async preflightSettlementJob(settlementJobId: string): Promise<SettlementPreflightReport> {
    const settlementJob = await this.prisma.settlementJob.findUnique({ where: { id: settlementJobId } });
    if (!settlementJob) {
      throw new Error("settlement job not found");
    }

    const { eligibleTickets, ticketCount } = await loadEligibleTickets(this.prisma, settlementJob.round_id);

    return {
      settlement_job_id: settlementJob.id,
      round_id: settlementJob.round_id,
      eligible_count: eligibleTickets.length,
      skipped_count: ticketCount - eligibleTickets.length,
      ticket_count: ticketCount
    };
  }
}

export function describeSettlementWorker(): string {
  return "settlement-worker: settles eligible tickets, records item outcomes, and enqueues safe Phase 1.5 payouts";
}

function settlementJobIdFromArgs(args: string[]): string | undefined {
  const explicit = args.find((arg) => arg.startsWith("--job-id="));
  if (explicit) {
    return explicit.slice("--job-id=".length) || undefined;
  }
  const positional = args[2];
  return positional && !positional.startsWith("--") ? positional : undefined;
}

const executedPath = process.argv[1] ?? "";

if (executedPath.endsWith("services/settlement-worker/src/main.ts") || executedPath.endsWith("services\\settlement-worker\\src\\main.ts") || executedPath.endsWith("services/settlement-worker/dist/main.js") || executedPath.endsWith("services\\settlement-worker\\dist\\main.js")) {
  const worker = new SettlementWorkerService();
  try {
    const report = await worker.settleSettlementJob(settlementJobIdFromArgs(process.argv));
    console.log(JSON.stringify(report));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "settlement failed");
    process.exitCode = 1;
  } finally {
    await worker.disconnect();
  }
}
