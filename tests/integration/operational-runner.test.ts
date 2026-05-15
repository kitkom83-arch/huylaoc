import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createNestApp, OpsService } from "../../services/lottery-api/dist/index.js";
import { closeDatabase, prisma, resetDatabase } from "../helpers/database.js";

async function createWalletOutbox(input: { suffix: string; status: "PENDING" | "PROCESSING" | "UNKNOWN" }) {
  return prisma.walletOutbox.create({
    data: {
      type: "WALLET_DEBIT",
      status: input.status,
      operation_ref: `ops-wallet-${input.suffix}`,
      wallet_account_ref: `wallet-${input.suffix}`,
      external_txn_ref: `external-${input.suffix}`,
      payload: {
        ticket_no: `OPS-WALLET-${input.suffix}`,
        stake_total: 10,
        currency_code: "THB"
      }
    }
  });
}

async function setOutboxUpdatedAt(outboxId: string, updatedAt: Date): Promise<void> {
  await prisma.$executeRaw`
    UPDATE wallet_outbox SET updated_at = ${updatedAt} WHERE id = CAST(${outboxId} AS uuid)
  `;
}

async function createSettlementFixture(suffix: string) {
  const round = await prisma.round.create({
    data: {
      round_code: `OPS-ROUND-${suffix}`,
      status: "RESULT_POSTED",
      opens_at: new Date("2026-05-14T01:00:00.000Z"),
      closes_at: new Date("2026-05-14T02:00:00.000Z"),
      draws_at: new Date("2026-05-14T02:00:00.000Z"),
      resulted_at: new Date("2026-05-14T02:05:00.000Z"),
      paytable_snapshot: []
    }
  });
  const quote = await prisma.quote.create({
    data: {
      quote_no: `OPS-QUOTE-${suffix}`,
      round_id: round.id,
      mode: "MANUAL_CREDIT",
      stake_total: 10,
      potential_payout_total: 900,
      currency: "THB",
      status: "USED",
      expires_at: new Date("2026-05-14T01:05:00.000Z"),
      request_hash: `ops-hash-${suffix}`,
      quote_snapshot: { suffix }
    }
  });
  const ticket = await prisma.ticket.create({
    data: {
      ticket_no: `OPS-TICKET-${suffix}`,
      round_id: round.id,
      quote_id: quote.id,
      mode: "MANUAL_CREDIT",
      stake_total: 10,
      potential_payout_total: 900,
      funding_status: "NOT_REQUIRED",
      settlement_status: "PENDING",
      payout_status: "NOT_REQUIRED",
      status: "CONFIRMED",
      idempotency_scope: "ops-runner-test",
      idempotency_key: `ops-ticket-${suffix}`,
      public_check_token_hash: `ops-token-hash-${suffix}`,
      items: {
        create: [{
          line_no: 1,
          bet_type_code: "TWO_STRAIGHT",
          selection_raw: "13",
          number: "13",
          stake: 10,
          odds_value: 90,
          potential_payout: 900,
          rule_snapshot: { bet_type: "TWO_STRAIGHT" }
        }]
      }
    }
  });
  await prisma.result.create({
    data: {
      round_id: round.id,
      result_6d: "000012",
      result_json: { result_6d: "000012" },
      posted_by_admin_id: "ops-test"
    }
  });
  const job = await prisma.settlementJob.create({
    data: {
      round_id: round.id,
      status: "PROCESSING",
      payload: { result_6d: "000012" }
    }
  });
  await prisma.$executeRaw`
    UPDATE settlement_jobs SET updated_at = ${new Date("2026-05-13T00:00:00.000Z")} WHERE id = CAST(${job.id} AS uuid)
  `;
  return { job, ticket };
}

describe("operational runner Phase 1.8", () => {
  let app: NestFastifyApplication;
  let ops: OpsService;

  beforeEach(async () => {
    process.env.NODE_ENV = "test";
    delete process.env.WORKER_SCHEDULER_ENABLED;
    delete process.env.WORKER_INTERVAL_MS;
    await resetDatabase();
    app = await createNestApp();
    ops = app.get(OpsService);
  });

  afterEach(async () => {
    ops.stopScheduler();
    await app.close();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("one operational cycle returns all report sections", async () => {
    const report = await ops.runOneCycle();

    expect(report).toMatchObject({
      wallet_recovery: expect.any(Object),
      wallet_processing: expect.any(Object),
      wallet_reconciliation: expect.any(Object),
      settlement_recovery: expect.any(Object),
      settlement_processing: expect.any(Object),
      started_at: expect.any(String),
      finished_at: expect.any(String),
      duration_ms: expect.any(Number)
    });
    expect(ops.getLastRun()).toEqual(report);
  });

  it("wallet recovery and wallet processing can run in the same cycle", async () => {
    const stale = await createWalletOutbox({ suffix: "STALE", status: "PROCESSING" });
    const pending = await createWalletOutbox({ suffix: "PENDING", status: "PENDING" });
    await setOutboxUpdatedAt(stale.id, new Date("2026-05-13T00:00:00.000Z"));

    const report = await ops.runOneCycle();

    expect(report.wallet_recovery).toMatchObject({ stale_recovered_count: 1, retried_count: 1 });
    expect(report.wallet_processing).toMatchObject({ processed_count: 1, succeeded_count: 1 });
    await expect(prisma.walletOutbox.findUniqueOrThrow({ where: { id: stale.id } }).then((row) => row.status)).resolves.toBe("PENDING");
    await expect(prisma.walletOutbox.findUniqueOrThrow({ where: { id: pending.id } }).then((row) => row.status)).resolves.toBe("SUCCEEDED");
  });

  it("settlement recovery and settlement processing can run in the same cycle", async () => {
    const { job, ticket } = await createSettlementFixture("RECOVER-PROCESS");

    const report = await ops.runOneCycle();

    expect(report.settlement_recovery).toMatchObject({ stale_recovered_count: 1, retried_count: 1 });
    expect(report.settlement_processing).toMatchObject({ settlement_job_id: job.id, processed_count: 1, succeeded_count: 1 });
    await expect(prisma.settlementJob.findUniqueOrThrow({ where: { id: job.id } }).then((row) => row.status)).resolves.toBe("SUCCEEDED");
    await expect(prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } }).then((row) => row.settlement_status)).resolves.toBe("LOST");
  });

  it("scheduler disabled by default does not start a background loop", () => {
    expect(ops.getSchedulerStatus()).toMatchObject({
      enabled: false,
      running: false,
      interval_ms: 30_000
    });
  });

  it("scheduler start and stop can be controlled in test", () => {
    expect(ops.startScheduler({ runImmediately: false })).toMatchObject({ running: true });
    expect(ops.getSchedulerStatus()).toMatchObject({ running: true });
    expect(ops.stopScheduler()).toMatchObject({ running: false });
  });
});
