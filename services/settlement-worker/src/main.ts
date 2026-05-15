import { randomUUID } from "node:crypto";
import { betTypeCodes, betTypeDigits, result6dSchema, type BetTypeCode } from "@lottery/domain";
import { Prisma, PrismaClient, type SettlementJob, type Ticket, type TicketItem } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;
type SettlementJobStatus = "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED";
type TicketWithItems = Ticket & { items: TicketItem[] };

export interface SettlementWorkerOptions {
  batchSize?: number;
  leaseTimeoutMs?: number;
  now?: () => Date;
}

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
  scanned_count: number;
  claimed_count: number;
  processed_count: number;
  succeeded_count: number;
  failed_count: number;
  unknown_count: number;
  retried_count: number;
  skipped_count: number;
  stale_recovered_count: number;
  tickets_total: number;
  tickets_done: number;
  winners_found: number;
  payouts_succeeded: number;
  payouts_failed: number;
}

export type StatusSummary = Record<string, number>;

const manualEligibleFundingStatuses = ["DEBITED", "SUCCEEDED", "NOT_REQUIRED"] as const;
const terminalSettlementJobStatuses = new Set<SettlementJobStatus>(["SUCCEEDED", "FAILED"]);
const workerActorId = "settlement-worker";

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
    scanned_count: typeof payload.scanned_count === "number" ? payload.scanned_count : 1,
    claimed_count: typeof payload.claimed_count === "number" ? payload.claimed_count : 0,
    processed_count: typeof payload.processed_count === "number" ? payload.processed_count : 0,
    succeeded_count: typeof payload.succeeded_count === "number" ? payload.succeeded_count : job.status === "SUCCEEDED" ? 1 : 0,
    failed_count: typeof payload.failed_count === "number" ? payload.failed_count : job.status === "FAILED" ? 1 : 0,
    unknown_count: typeof payload.unknown_count === "number" ? payload.unknown_count : 0,
    retried_count: typeof payload.retried_count === "number" ? payload.retried_count : 0,
    skipped_count: typeof payload.skipped_count === "number" ? payload.skipped_count : 0,
    stale_recovered_count: typeof payload.stale_recovered_count === "number" ? payload.stale_recovered_count : 0,
    tickets_total: typeof payload.tickets_total === "number" ? payload.tickets_total : 0,
    tickets_done: typeof payload.tickets_done === "number" ? payload.tickets_done : 0,
    winners_found: typeof payload.winners_found === "number" ? payload.winners_found : 0,
    payouts_succeeded: typeof payload.payouts_succeeded === "number" ? payload.payouts_succeeded : 0,
    payouts_failed: typeof payload.payouts_failed === "number" ? payload.payouts_failed : 0
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

async function appendSettlementAudit(
  db: DbClient,
  job: SettlementJob,
  previousStatus: SettlementJobStatus,
  nextStatus: SettlementJobStatus,
  action = "SETTLEMENT_JOB_STATUS_CHANGE",
  extra: Record<string, unknown> = {}
): Promise<void> {
  await db.auditLog.create({
    data: {
      actor_type: "SYSTEM",
      actor_id: workerActorId,
      action,
      resource_type: "settlement_job",
      resource_id: job.id,
      before: { status: previousStatus, round_id: job.round_id },
      after: {
        status: nextStatus,
        round_id: job.round_id,
        ...extra
      }
    }
  });
}

async function payoutLedgerExists(db: Prisma.TransactionClient, ticketId: string): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM credit_ledger
      WHERE type::text = 'PAYOUT_CREDIT'
        AND metadata->>'ticket_id' = ${ticketId}
    ) AS exists
  `;
  return rows[0]?.exists ?? false;
}

async function creditManualPayout(db: Prisma.TransactionClient, ticket: Ticket, payoutTotal: number, settlementJobId: string): Promise<void> {
  if (!ticket.manual_user_id) {
    throw new Error("manual ticket has no manual user");
  }
  if (await payoutLedgerExists(db, ticket.id)) {
    return;
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
  const existingOutbox = await db.walletOutbox.findFirst({
    where: {
      ticket_id: ticket.id,
      type: "WALLET_CREDIT"
    },
    select: { id: true }
  });
  if (existingOutbox) {
    return;
  }

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
  private readonly options: Required<SettlementWorkerOptions>;

  constructor(private readonly prisma: PrismaClient = new PrismaClient(), options: SettlementWorkerOptions = {}) {
    this.options = {
      batchSize: options.batchSize ?? 25,
      leaseTimeoutMs: options.leaseTimeoutMs ?? 5 * 60_000,
      now: options.now ?? (() => new Date())
    };
  }

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
        const jobStatus = job.status as SettlementJobStatus;
        if (terminalSettlementJobStatuses.has(jobStatus)) {
          return reportFromJob(job);
        }
        if (jobStatus !== "PENDING") {
          return reportFromJob(job);
        }

        const claimed = await tx.settlementJob.updateMany({
          where: { id: job.id, status: "PENDING" },
          data: { status: "PROCESSING" }
        });
        if (claimed.count !== 1) {
          const current = await tx.settlementJob.findUniqueOrThrow({ where: { id: job.id } });
          return reportFromJob(current);
        }

        const result6d = await loadResult6d(tx, job);
        result6dSchema.parse(result6d);
        const { eligibleTickets, ticketCount } = await loadEligibleTickets(tx, job.round_id);
        const report: SettlementRunReport = {
          settlement_job_id: job.id,
          round_id: job.round_id,
          status: "SUCCEEDED",
          scanned_count: 1,
          claimed_count: 1,
          processed_count: 0,
          succeeded_count: 0,
          failed_count: 0,
          unknown_count: 0,
          retried_count: 0,
          skipped_count: ticketCount - eligibleTickets.length,
          stale_recovered_count: 0,
          tickets_total: eligibleTickets.length,
          tickets_done: 0,
          winners_found: 0,
          payouts_succeeded: 0,
          payouts_failed: 0
        };

        for (const ticket of eligibleTickets) {
          const settled = await settleTicket(tx, ticket, result6d, job.id);
          report.tickets_done += 1;
          report.winners_found += settled.won ? 1 : 0;
          report.payouts_succeeded += settled.payoutSucceeded ? 1 : 0;
          report.payouts_failed += settled.payoutFailed ? 1 : 0;
        }

        report.status = report.payouts_failed > 0 ? "FAILED" : "SUCCEEDED";
        report.processed_count = 1;
        report.succeeded_count = report.status === "SUCCEEDED" ? 1 : 0;
        report.failed_count = report.status === "FAILED" ? 1 : 0;
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
              skipped_count: report.skipped_count,
              scanned_count: report.scanned_count,
              claimed_count: report.claimed_count,
              processed_count: report.processed_count,
              succeeded_count: report.succeeded_count,
              failed_count: report.failed_count,
              unknown_count: report.unknown_count,
              retried_count: report.retried_count,
              stale_recovered_count: report.stale_recovered_count
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

  async recoverStaleProcessingJobs(limit = this.options.batchSize): Promise<SettlementRunReport> {
    const cutoff = new Date(this.options.now().getTime() - this.options.leaseTimeoutMs);
    const rows = await this.prisma.$transaction(async (tx) => {
      return tx.$queryRaw<Array<SettlementJob>>`
        SELECT *
        FROM settlement_jobs
        WHERE status = 'PROCESSING'
          AND updated_at <= ${cutoff}
        ORDER BY updated_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `;
    });
    const report = emptySettlementWorkerReport(rows[0]);
    report.scanned_count = rows.length;
    report.claimed_count = rows.length;

    for (const job of rows) {
      const recovered = await this.prisma.$transaction(async (tx) => {
        const locked = await lockSettlementJob(tx, job.id);
        const status = locked.status as SettlementJobStatus;
        if (terminalSettlementJobStatuses.has(status) || status !== "PROCESSING" || locked.updated_at > cutoff) {
          return false;
        }
        const payload = typeof locked.payload === "object" && locked.payload !== null && !Array.isArray(locked.payload)
          ? locked.payload as Prisma.JsonObject
          : {};
        const recoveryCount = typeof payload.recovery_count === "number" ? payload.recovery_count + 1 : 1;
        await tx.settlementJob.update({
          where: { id: locked.id },
          data: {
            status: "PENDING",
            payload: {
              ...payload,
              recovery_count: recoveryCount,
              recovered_from_status: "PROCESSING",
              stale_recovered_at: this.options.now().toISOString()
            }
          }
        });
        await appendSettlementAudit(tx, locked, "PROCESSING", "PENDING", "SETTLEMENT_JOB_STALE_RECOVERED", {
          recovery_count: recoveryCount,
          lease_timeout_ms: this.options.leaseTimeoutMs
        });
        return true;
      });
      if (recovered) {
        report.processed_count += 1;
        report.retried_count += 1;
        report.stale_recovered_count += 1;
      } else {
        report.skipped_count += 1;
      }
    }

    return report;
  }

  async getSettlementJobSummaryByStatus(): Promise<StatusSummary> {
    const rows = await this.prisma.settlementJob.groupBy({
      by: ["status"],
      _count: { _all: true }
    });
    return Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
  }
}

function emptySettlementWorkerReport(job?: SettlementJob): SettlementRunReport {
  return {
    settlement_job_id: job?.id ?? "",
    round_id: job?.round_id ?? "",
    status: (job?.status as SettlementJobStatus | undefined) ?? "PENDING",
    scanned_count: 0,
    claimed_count: 0,
    processed_count: 0,
    succeeded_count: 0,
    failed_count: 0,
    unknown_count: 0,
    retried_count: 0,
    skipped_count: 0,
    stale_recovered_count: 0,
    tickets_total: 0,
    tickets_done: 0,
    winners_found: 0,
    payouts_succeeded: 0,
    payouts_failed: 0
  };
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
