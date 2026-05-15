import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createNestApp } from "../../services/lottery-api/dist/index.js";
import { SettlementWorkerService } from "../../services/settlement-worker/dist/main.js";
import { WalletOutboxStateService } from "../../services/wallet-outbox-worker/dist/main.js";
import { closeDatabase, prisma, resetDatabase } from "../helpers/database.js";

const adminHeaders = {
  "x-admin-id": "admin-test",
  "x-admin-role": "admin"
};
const baseDate = new Date("2026-05-14T00:00:00.000Z");

function idempotency(key: string) {
  return { "Idempotency-Key": key };
}

async function createRound(app: NestFastifyApplication, code: string) {
  const response = await request(app.getHttpServer())
    .post("/v1/admin/rounds")
    .set(adminHeaders)
    .set(idempotency(`round-${code}`))
    .send({
      round_code: code,
      opens_at: "2026-05-12T01:00:00.000Z",
      closes_at: "2026-05-12T02:00:00.000Z",
      draws_at: "2026-05-12T02:00:00.000Z",
      status: "OPEN"
    });
  expect(response.status).toBe(201);
  return response.body.round as { id: string; round_code: string };
}

async function createManualUser(app: NestFastifyApplication, suffix: string, topupAmount = 1000) {
  const user = await request(app.getHttpServer())
    .post("/v1/admin/manual/users")
    .set(adminHeaders)
    .set(idempotency(`settle-user-${suffix}`))
    .send({ username: `settle_user_${suffix}`, display_name: "Settlement User", password: "strong-password" });
  expect(user.status).toBe(201);

  const topup = await request(app.getHttpServer())
    .post("/v1/admin/manual/credits/topup")
    .set(adminHeaders)
    .set(idempotency(`settle-topup-${suffix}`))
    .send({ manual_user_id: user.body.user.id, amount: topupAmount, reason: "settlement test topup" });
  expect(topup.status).toBe(201);
  return user.body.user as { id: string };
}

async function createManualTicket(app: NestFastifyApplication, input: { roundId: string; userId: string; suffix: string; selection: string; stake?: number }) {
  const quote = await request(app.getHttpServer())
    .post("/v1/quotes")
    .set(idempotency(`settle-manual-quote-${input.suffix}`))
    .send({
      round_id: input.roundId,
      payment_mode: "MANUAL_CREDIT",
      currency_code: "THB",
      user_manual_id: input.userId,
      items: [{ bet_type: "TWO_STRAIGHT", selection: input.selection, stake: input.stake ?? 10 }]
    });
  expect(quote.status).toBe(201);

  const confirm = await request(app.getHttpServer())
    .post("/v1/tickets/confirm")
    .set(idempotency(`settle-manual-confirm-${input.suffix}`))
    .send({ quote_id: quote.body.quote_id });
  expect(confirm.status).toBe(201);
  return prisma.ticket.findUniqueOrThrow({ where: { ticket_no: confirm.body.ticket_no } });
}

async function createExternalTicket(app: NestFastifyApplication, input: { roundId: string; suffix: string; selection: string; stake?: number }) {
  const quote = await request(app.getHttpServer())
    .post("/v1/quotes")
    .set(idempotency(`settle-external-quote-${input.suffix}`))
    .send({
      round_id: input.roundId,
      payment_mode: "EXTERNAL_WALLET",
      currency_code: "THB",
      wallet_account_ref: `wallet-${input.suffix}`,
      external_txn_ref: `txn-${input.suffix}`,
      items: [{ bet_type: "ONE_DIGIT", selection: input.selection, stake: input.stake ?? 5 }]
    });
  expect(quote.status).toBe(201);

  const confirm = await request(app.getHttpServer())
    .post("/v1/tickets/confirm")
    .set(idempotency(`settle-external-confirm-${input.suffix}`))
    .send({ quote_id: quote.body.quote_id });
  expect(confirm.status).toBe(201);

  const ticket = await prisma.ticket.findUniqueOrThrow({ where: { ticket_no: confirm.body.ticket_no } });
  const outbox = await prisma.walletOutbox.findFirstOrThrow({ where: { ticket_id: ticket.id, type: "WALLET_DEBIT" } });
  return { ticket, outbox };
}

async function postResult(app: NestFastifyApplication, roundId: string, suffix: string, result6d = "000012") {
  const response = await request(app.getHttpServer())
    .post("/v1/admin/results")
    .set(adminHeaders)
    .set(idempotency(`settle-result-${suffix}`))
    .send({ round_id: roundId, result_6d: result6d });
  expect(response.status).toBe(201);
  return response.body.settlement_job as { id: string; round_id: string };
}

function payoutCreditLedgerCount(ticketId?: string): Promise<number> {
  if (!ticketId) {
    return prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM credit_ledger WHERE type::text = 'PAYOUT_CREDIT'
    `.then((rows) => Number(rows[0]?.count ?? 0));
  }
  return prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count FROM credit_ledger WHERE type::text = 'PAYOUT_CREDIT' AND metadata->>'ticket_id' = ${ticketId}
  `.then((rows) => Number(rows[0]?.count ?? 0));
}

async function setSettlementJobUpdatedAt(jobId: string, status: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED", updatedAt: Date): Promise<void> {
  await prisma.$executeRaw`
    UPDATE settlement_jobs SET status = ${status}, updated_at = ${updatedAt} WHERE id = CAST(${jobId} AS uuid)
  `;
}

async function makeTicketSettlementPending(ticketId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE tickets
    SET
      status = 'CONFIRMED',
      settlement_status = 'PENDING',
      payout_status = CAST('NOT_SETTLED' AS payout_status),
      actual_payout_total = 0,
      updated_at = now()
    WHERE id = CAST(${ticketId} AS uuid)
  `;
}

async function settlementAuditCount(action: string, resourceId?: string): Promise<number> {
  return prisma.auditLog.count({ where: { action, ...(resourceId ? { resource_id: resourceId } : {}) } });
}

describe("settlement Phase 1.5 worker", () => {
  let app: NestFastifyApplication;
  let settlement: SettlementWorkerService;
  let walletOutbox: WalletOutboxStateService;

  beforeEach(async () => {
    process.env.NODE_ENV = "test";
    await resetDatabase();
    app = await createNestApp();
    settlement = new SettlementWorkerService(prisma);
    walletOutbox = new WalletOutboxStateService(prisma);
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("eligible manual credit winning ticket gets PAYOUT_CREDIT", async () => {
    const round = await createRound(app, "SETTLE-MANUAL-WIN");
    const user = await createManualUser(app, "manual_win");
    const ticket = await createManualTicket(app, { roundId: round.id, userId: user.id, suffix: "manual-win", selection: "12" });
    const job = await postResult(app, round.id, "manual-win");

    const report = await settlement.settleSettlementJob(job.id);
    const updatedTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id }, include: { items: true } });
    const account = await prisma.creditAccount.findUniqueOrThrow({ where: { manual_user_id: user.id } });

    expect(report).toMatchObject({ tickets_total: 1, tickets_done: 1, winners_found: 1, payouts_succeeded: 1, status: "SUCCEEDED" });
    expect(updatedTicket.status).toBe("SETTLED");
    expect(updatedTicket.settlement_status).toBe("WON");
    expect(updatedTicket.payout_status).toBe("SUCCEEDED");
    expect(Number(updatedTicket.actual_payout_total)).toBe(900);
    expect(updatedTicket.items[0]?.win_status).toBe("WON");
    expect(Number(updatedTicket.items[0]?.payout_amount ?? 0)).toBe(900);
    await expect(payoutCreditLedgerCount(ticket.id)).resolves.toBe(1);
    expect(Number(account.balance)).toBe(1890);
  });

  it("eligible manual credit losing ticket is LOST with payout_total 0", async () => {
    const round = await createRound(app, "SETTLE-MANUAL-LOSE");
    const user = await createManualUser(app, "manual_lose");
    const ticket = await createManualTicket(app, { roundId: round.id, userId: user.id, suffix: "manual-lose", selection: "13" });
    const job = await postResult(app, round.id, "manual-lose");

    const report = await settlement.settleSettlementJob(job.id);
    const updatedTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id }, include: { items: true } });

    expect(report).toMatchObject({ tickets_total: 1, tickets_done: 1, winners_found: 0, payouts_succeeded: 0, status: "SUCCEEDED" });
    expect(updatedTicket.settlement_status).toBe("LOST");
    expect(updatedTicket.payout_status).toBe("NO_WIN");
    expect(Number(updatedTicket.actual_payout_total)).toBe(0);
    expect(updatedTicket.items[0]?.win_status).toBe("LOST");
    expect(Number(updatedTicket.items[0]?.payout_amount ?? 0)).toBe(0);
    await expect(payoutCreditLedgerCount(ticket.id)).resolves.toBe(0);
  });

  it("external wallet winner creates WALLET_CREDIT outbox without real wallet call", async () => {
    const round = await createRound(app, "SETTLE-WALLET-WIN");
    const { ticket, outbox } = await createExternalTicket(app, { roundId: round.id, suffix: "wallet-win", selection: "2" });
    await walletOutbox.markWalletOutboxSucceeded(outbox.id);
    const job = await postResult(app, round.id, "wallet-win");

    const report = await settlement.settleQueuedJob();
    const updatedTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    const creditOutbox = await prisma.walletOutbox.findFirstOrThrow({ where: { ticket_id: ticket.id, type: "WALLET_CREDIT" } });

    expect(report.settlement_job_id).toBe(job.id);
    expect(updatedTicket.settlement_status).toBe("WON");
    expect(updatedTicket.payout_status).toBe("PENDING");
    expect(Number(updatedTicket.actual_payout_total)).toBe(45);
    expect(creditOutbox.status).toBe("PENDING");
    expect(creditOutbox.wallet_account_ref).toBe("wallet-wallet-win");
    expect(await prisma.walletOutbox.count({ where: { ticket_id: ticket.id, type: "WALLET_CREDIT" } })).toBe(1);
    await expect(payoutCreditLedgerCount()).resolves.toBe(0);
  });

  it("ineligible UNKNOWN and FAILED wallet debit tickets are skipped", async () => {
    const round = await createRound(app, "SETTLE-WALLET-SKIP");
    const failed = await createExternalTicket(app, { roundId: round.id, suffix: "wallet-failed", selection: "2" });
    const unknown = await createExternalTicket(app, { roundId: round.id, suffix: "wallet-unknown", selection: "2" });
    await walletOutbox.markWalletOutboxFailed(failed.outbox.id);
    await walletOutbox.markWalletOutboxUnknown(unknown.outbox.id);
    const job = await postResult(app, round.id, "wallet-skip");

    const report = await settlement.settleSettlementJob(job.id);
    const failedTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: failed.ticket.id } });
    const unknownTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: unknown.ticket.id } });

    expect(report).toMatchObject({ tickets_total: 0, tickets_done: 0, skipped_count: 2, status: "SUCCEEDED" });
    expect(failedTicket.settlement_status).toBe("PENDING");
    expect(unknownTicket.settlement_status).toBe("PENDING");
    await expect(prisma.walletOutbox.count({ where: { type: "WALLET_CREDIT" } })).resolves.toBe(0);
  });

  it("already settled ticket is not paid twice", async () => {
    const round = await createRound(app, "SETTLE-ALREADY");
    const user = await createManualUser(app, "already");
    const ticket = await createManualTicket(app, { roundId: round.id, userId: user.id, suffix: "already", selection: "12" });
    await prisma.$executeRaw`
      UPDATE tickets
      SET status = 'SETTLED', settlement_status = 'WON', payout_status = CAST('SUCCEEDED' AS payout_status), actual_payout_total = 900
      WHERE id = CAST(${ticket.id} AS uuid)
    `;
    const job = await postResult(app, round.id, "already");

    const report = await settlement.settleSettlementJob(job.id);

    expect(report).toMatchObject({ tickets_total: 0, tickets_done: 0, skipped_count: 1, status: "SUCCEEDED" });
    await expect(payoutCreditLedgerCount(ticket.id)).resolves.toBe(0);
  });

  it("rerunning settlement job does not duplicate payout", async () => {
    const round = await createRound(app, "SETTLE-RERUN");
    const user = await createManualUser(app, "rerun");
    const ticket = await createManualTicket(app, { roundId: round.id, userId: user.id, suffix: "rerun", selection: "12" });
    const job = await postResult(app, round.id, "rerun");

    const first = await settlement.settleSettlementJob(job.id);
    const second = await settlement.settleSettlementJob(job.id);

    expect(first).toMatchObject({ tickets_total: 1, tickets_done: 1, winners_found: 1, payouts_succeeded: 1, status: "SUCCEEDED" });
    expect(second).toEqual(first);
    await expect(payoutCreditLedgerCount(ticket.id)).resolves.toBe(1);
    await expect(prisma.walletOutbox.count({ where: { type: "WALLET_CREDIT" } })).resolves.toBe(0);
  });

  it("settlement job summary and progress are updated", async () => {
    const round = await createRound(app, "SETTLE-PROGRESS");
    const user = await createManualUser(app, "progress");
    await createManualTicket(app, { roundId: round.id, userId: user.id, suffix: "progress-win", selection: "12" });
    await createManualTicket(app, { roundId: round.id, userId: user.id, suffix: "progress-loss", selection: "13" });
    const skipped = await createExternalTicket(app, { roundId: round.id, suffix: "progress-skip", selection: "2" });
    await walletOutbox.markWalletOutboxUnknown(skipped.outbox.id);
    const job = await postResult(app, round.id, "progress");

    const report = await settlement.settleSettlementJob(job.id);
    const storedJob = await prisma.settlementJob.findUniqueOrThrow({ where: { id: job.id } });
    const payload = storedJob.payload as {
      tickets_total: number;
      tickets_done: number;
      winners_found: number;
      payouts_succeeded: number;
      payouts_failed: number;
      skipped_count: number;
    };

    expect(report).toMatchObject({
      tickets_total: 2,
      tickets_done: 2,
      winners_found: 1,
      payouts_succeeded: 1,
      payouts_failed: 0,
      skipped_count: 1,
      status: "SUCCEEDED"
    });
    expect(storedJob.status).toBe("SUCCEEDED");
    expect(payload).toMatchObject({
      tickets_total: 2,
      tickets_done: 2,
      winners_found: 1,
      payouts_succeeded: 1,
      payouts_failed: 0,
      skipped_count: 1
    });
  });

  it("stale PROCESSING settlement job is recovered and can be retried safely", async () => {
    const round = await createRound(app, "SETTLE-STALE-RECOVER");
    const user = await createManualUser(app, "stale_recover");
    await createManualTicket(app, { roundId: round.id, userId: user.id, suffix: "stale-recover", selection: "13" });
    const job = await postResult(app, round.id, "stale-recover");
    const recoveryWorker = new SettlementWorkerService(prisma, { now: () => baseDate, leaseTimeoutMs: 5 * 60_000 });
    await setSettlementJobUpdatedAt(job.id, "PROCESSING", new Date("2026-05-13T23:50:00.000Z"));

    const recovery = await recoveryWorker.recoverStaleProcessingJobs();
    const recoveredJob = await prisma.settlementJob.findUniqueOrThrow({ where: { id: job.id } });
    const report = await recoveryWorker.settleSettlementJob(job.id);
    const summary = await recoveryWorker.getSettlementJobSummaryByStatus();

    expect(recovery).toMatchObject({
      scanned_count: 1,
      claimed_count: 1,
      processed_count: 1,
      retried_count: 1,
      stale_recovered_count: 1
    });
    expect(recoveredJob.status).toBe("PENDING");
    expect(report).toMatchObject({ status: "SUCCEEDED", tickets_done: 1, winners_found: 0 });
    expect(summary).toMatchObject({ SUCCEEDED: 1 });
    await expect(settlementAuditCount("SETTLEMENT_JOB_STALE_RECOVERED", job.id)).resolves.toBe(1);
  });

  it("rerun after stale recovery does not duplicate manual payout credit", async () => {
    const round = await createRound(app, "SETTLE-NO-DUP-MANUAL");
    const user = await createManualUser(app, "no_dup_manual");
    const ticket = await createManualTicket(app, { roundId: round.id, userId: user.id, suffix: "no-dup-manual", selection: "12" });
    const job = await postResult(app, round.id, "no-dup-manual");
    const recoveryWorker = new SettlementWorkerService(prisma, { now: () => baseDate, leaseTimeoutMs: 5 * 60_000 });

    await settlement.settleSettlementJob(job.id);
    await expect(payoutCreditLedgerCount(ticket.id)).resolves.toBe(1);
    await makeTicketSettlementPending(ticket.id);
    await setSettlementJobUpdatedAt(job.id, "PROCESSING", new Date("2026-05-13T23:50:00.000Z"));

    await recoveryWorker.recoverStaleProcessingJobs();
    const rerun = await recoveryWorker.settleSettlementJob(job.id);
    const account = await prisma.creditAccount.findUniqueOrThrow({ where: { manual_user_id: user.id } });

    expect(rerun).toMatchObject({ status: "SUCCEEDED", tickets_done: 1, winners_found: 1, payouts_succeeded: 1 });
    await expect(payoutCreditLedgerCount(ticket.id)).resolves.toBe(1);
    expect(Number(account.balance)).toBe(1890);
  });

  it("rerun after stale recovery does not duplicate wallet credit outbox", async () => {
    const round = await createRound(app, "SETTLE-NO-DUP-WALLET");
    const { ticket, outbox } = await createExternalTicket(app, { roundId: round.id, suffix: "no-dup-wallet", selection: "2" });
    await walletOutbox.markWalletOutboxSucceeded(outbox.id);
    const job = await postResult(app, round.id, "no-dup-wallet");
    const recoveryWorker = new SettlementWorkerService(prisma, { now: () => baseDate, leaseTimeoutMs: 5 * 60_000 });

    await settlement.settleSettlementJob(job.id);
    await expect(prisma.walletOutbox.count({ where: { ticket_id: ticket.id, type: "WALLET_CREDIT" } })).resolves.toBe(1);
    await makeTicketSettlementPending(ticket.id);
    await setSettlementJobUpdatedAt(job.id, "PROCESSING", new Date("2026-05-13T23:50:00.000Z"));

    await recoveryWorker.recoverStaleProcessingJobs();
    const rerun = await recoveryWorker.settleSettlementJob(job.id);

    expect(rerun).toMatchObject({ status: "SUCCEEDED", tickets_done: 1, winners_found: 1 });
    await expect(prisma.walletOutbox.count({ where: { ticket_id: ticket.id, type: "WALLET_CREDIT" } })).resolves.toBe(1);
    await expect(payoutCreditLedgerCount()).resolves.toBe(0);
  });
});
