import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createNestApp, OpsService } from "../../services/lottery-api/dist/index.js";
import { closeDatabase, prisma, resetDatabase } from "../helpers/database.js";

const adminHeaders = {
  "x-admin-id": "admin-test",
  "x-admin-role": "admin"
};

async function createRound(code: string) {
  return prisma.round.create({
    data: {
      round_code: code,
      status: "OPEN",
      opens_at: new Date("2026-05-14T01:00:00.000Z"),
      closes_at: new Date("2026-05-14T02:00:00.000Z"),
      draws_at: new Date("2026-05-14T02:00:00.000Z"),
      paytable_snapshot: []
    }
  });
}

async function seedOpsSummaryRows() {
  const round = await createRound("OPS-ENDPOINTS");
  await prisma.walletOutbox.createMany({
    data: [
      {
        type: "WALLET_DEBIT",
        status: "PENDING",
        operation_ref: "ops-summary-pending",
        wallet_account_ref: "wallet-summary-pending",
        external_txn_ref: "external-summary-pending",
        payload: { token_probe: "not-a-real-token" }
      },
      {
        type: "WALLET_CREDIT",
        status: "SUCCEEDED",
        operation_ref: "ops-summary-succeeded",
        wallet_account_ref: "wallet-summary-succeeded",
        external_txn_ref: "external-summary-succeeded",
        payload: { password_probe: "not-a-real-password" }
      }
    ]
  });
  await prisma.settlementJob.createMany({
    data: [
      { round_id: round.id, status: "PENDING", payload: { public_check_token: "must-not-return" } },
      { round_id: round.id, status: "SUCCEEDED", payload: { secret: "must-not-return" } }
    ]
  });
}

async function databaseCounts() {
  const [walletOutbox, settlementJobs, auditLogs] = await Promise.all([
    prisma.walletOutbox.count(),
    prisma.settlementJob.count(),
    prisma.auditLog.count()
  ]);
  return { walletOutbox, settlementJobs, auditLogs };
}

describe("ops read-only endpoints Phase 1.8", () => {
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

  it("read-only summary endpoints return expected shapes and counts", async () => {
    await ops.runOneCycle();
    await seedOpsSummaryRows();

    const wallet = await request(app.getHttpServer()).get("/v1/admin/ops/wallet-outbox/summary").set(adminHeaders);
    const settlement = await request(app.getHttpServer()).get("/v1/admin/ops/settlement-jobs/summary").set(adminHeaders);
    const lastRun = await request(app.getHttpServer()).get("/v1/admin/ops/worker/last-run").set(adminHeaders);

    expect(wallet.status).toBe(200);
    expect(wallet.body).toMatchObject({
      status_counts: expect.any(Object),
      last_run: expect.any(Object),
      scheduler: { enabled: false, running: false, interval_ms: 30_000 }
    });
    expect(wallet.body.status_counts).toMatchObject({ PENDING: 1, SUCCEEDED: 1 });

    expect(settlement.status).toBe(200);
    expect(settlement.body).toMatchObject({
      status_counts: expect.any(Object),
      last_run: expect.any(Object),
      scheduler: { enabled: false, running: false, interval_ms: 30_000 }
    });
    expect(settlement.body.status_counts).toMatchObject({ PENDING: 1, SUCCEEDED: 1 });

    expect(lastRun.status).toBe(200);
    expect(lastRun.body).toMatchObject({
      last_run: {
        wallet_recovery: expect.any(Object),
        wallet_processing: expect.any(Object),
        wallet_reconciliation: expect.any(Object),
        settlement_recovery: expect.any(Object),
        settlement_processing: expect.any(Object),
        started_at: expect.any(String),
        finished_at: expect.any(String),
        duration_ms: expect.any(Number)
      },
      scheduler: { enabled: false, running: false, interval_ms: 30_000 }
    });
  });

  it("ops endpoints are admin guarded", async () => {
    const response = await request(app.getHttpServer()).get("/v1/admin/ops/wallet-outbox/summary");
    expect(response.status).toBe(403);
  });

  it("summary endpoints do not mutate database state", async () => {
    await seedOpsSummaryRows();
    const before = await databaseCounts();

    await request(app.getHttpServer()).get("/v1/admin/ops/wallet-outbox/summary").set(adminHeaders).expect(200);
    await request(app.getHttpServer()).get("/v1/admin/ops/settlement-jobs/summary").set(adminHeaders).expect(200);
    await request(app.getHttpServer()).get("/v1/admin/ops/worker/last-run").set(adminHeaders).expect(200);

    await expect(databaseCounts()).resolves.toEqual(before);
  });

  it("ops endpoints do not return secret or token fields", async () => {
    await seedOpsSummaryRows();

    const responses = await Promise.all([
      request(app.getHttpServer()).get("/v1/admin/ops/wallet-outbox/summary").set(adminHeaders),
      request(app.getHttpServer()).get("/v1/admin/ops/settlement-jobs/summary").set(adminHeaders),
      request(app.getHttpServer()).get("/v1/admin/ops/worker/last-run").set(adminHeaders)
    ]);
    const responseText = JSON.stringify(responses.map((response) => response.body));

    expect(responseText).not.toContain("public_check_token");
    expect(responseText).not.toContain("password");
    expect(responseText).not.toContain("secret");
    expect(responseText).not.toContain("must-not-return");
    expect(responseText).not.toContain("not-a-real-token");
  });
});
