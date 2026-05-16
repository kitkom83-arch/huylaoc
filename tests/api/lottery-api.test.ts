import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createNestApp } from "../../services/lottery-api/dist/index.js";
import { closeDatabase, prisma, resetDatabase } from "../helpers/database.js";

const adminHeaders = {
  "x-admin-id": "admin-test",
  "x-admin-role": "admin"
};

function idempotency(key: string) {
  return { "Idempotency-Key": key };
}

function roundBody(code: string) {
  return {
    round_code: code,
    opens_at: "2026-05-12T01:00:00.000Z",
    closes_at: "2026-05-12T02:00:00.000Z",
    draws_at: "2026-05-12T02:00:00.000Z",
    status: "OPEN"
  };
}

async function createSettlementJob() {
  const round = await prisma.round.create({
    data: {
      round_code: "SETTLEMENT-READ",
      status: "RESULT_POSTED",
      opens_at: new Date("2026-05-12T01:00:00.000Z"),
      closes_at: new Date("2026-05-12T02:00:00.000Z"),
      draws_at: new Date("2026-05-12T02:00:00.000Z"),
      paytable_snapshot: []
    }
  });

  return prisma.settlementJob.create({
    data: {
      round_id: round.id,
      status: "SUCCEEDED",
      payload: {
        tickets_total: 2,
        tickets_done: 2,
        winners_found: 1,
        payouts_succeeded: 1,
        payouts_failed: 0,
        scanned_count: 1,
        claimed_count: 1,
        processed_count: 1,
        succeeded_count: 1,
        failed_count: 0,
        unknown_count: 0,
        retried_count: 0,
        skipped_count: 0,
        stale_recovered_count: 0,
        secret: "must-not-return"
      }
    }
  });
}

async function createAuditLog(input: Partial<{
  actor_type: string;
  actor_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  before: object;
  after: object;
  created_at: Date;
}> = {}) {
  return prisma.auditLog.create({
    data: {
      actor_type: input.actor_type ?? "ADMIN",
      actor_id: input.actor_id ?? "admin-demo",
      action: input.action ?? "MANUAL_TOPUP",
      resource_type: input.resource_type ?? "credit_account",
      resource_id: input.resource_id ?? "credit-account-1",
      before: input.before,
      after: input.after,
      created_at: input.created_at
    }
  });
}

async function createManualUser(app: NestFastifyApplication, key = "api-status-user") {
  return request(app.getHttpServer())
    .post("/v1/admin/manual/users")
    .set(adminHeaders)
    .set(idempotency(key))
    .send({ username: `user_${key}`, display_name: "Manual User", password: "strong-password" });
}

describe("lottery-api P0 foundation", () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    process.env.NODE_ENV = "test";
    await resetDatabase();
    app = await createNestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("GET /api/health returns ok true", async () => {
    const response = await request(app.getHttpServer()).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, service: "lottery-api" });
  });

  it("GET / returns the demo index page", async () => {
    const response = await request(app.getHttpServer()).get("/");
    expect(response.status).toBe(200);
    expect(response.text).toContain("Lottery Game Engine Demo");
    expect(response.text).toContain("/demo/project-overview");
    expect(response.text).toContain('href="/demo/wallet-outbox-monitor"');
  });

  it("GET /demo/project-overview returns the project overview page", async () => {
    const response = await request(app.getHttpServer()).get("/demo/project-overview");
    expect(response.status).toBe(200);
    expect(response.text).toContain("ภาพรวมโปรเจกต์ Lottery Game Engine");
    expect(response.text).toContain("Current System Status");
    expect(response.text).toContain("Completed Work");
    expect(response.text).toContain("Remaining Work");
    expect(response.text).toContain("API Inventory");
    expect(response.text).toContain("Local Commands");
    expect(response.text).toContain("Important Safety Notes");
    expect(response.text).toContain("Phase 0");
    expect(response.text).toContain("Phase 0.5");
    expect(response.text).toContain("Phase 1.0");
    expect(response.text).toContain("Phase 1.1");
    expect(response.text).toContain("Phase 1.2");
    expect(response.text).toContain("Phase 1.5");
    expect(response.text).toContain("Phase 1.6");
    expect(response.text).toContain("Phase 2.0");
    expect(response.text).toContain("Phase 2.1");
    expect(response.text).toContain("Phase 2.2");
    expect(response.text).toContain("Phase 3.0");
    expect(response.text).toContain("Done");
    expect(response.text).toContain("Current");
    expect(response.text).toContain("Remaining");
    expect(response.text).toContain('href="/demo/wallet-outbox-monitor"');
  });

  it("GET /demo/customer-th returns the Thai customer demo page", async () => {
    const response = await request(app.getHttpServer()).get("/demo/customer-th");
    expect(response.status).toBe(200);
    expect(response.text).toContain("หน้าเดโมลูกค้า หวยลาว");
  });

  it("GET /demo/customer-la returns the Lao customer demo page", async () => {
    const response = await request(app.getHttpServer()).get("/demo/customer-la");
    expect(response.status).toBe(200);
    expect(response.text).toContain("ໜ້າສາທິດລູກຄ້າ ຫວຍລາວ");
  });

  it("GET /demo/backoffice returns the backoffice demo page", async () => {
    const response = await request(app.getHttpServer()).get("/demo/backoffice");
    expect(response.status).toBe(200);
    expect(response.text).toContain("Backoffice Demo");
    expect(response.text).toContain('href="/demo/settlement-center"');
    expect(response.text).toContain('href="/demo/wallet-outbox-monitor"');
  });

  it("GET /demo/project-overview returns the project overview page", async () => {
    const response = await request(app.getHttpServer()).get("/demo/project-overview");
    expect(response.status).toBe(200);
    expect(response.text).toContain("ภาพรวมโปรเจกต์ Lottery Game Engine");
    expect(response.text).toContain("Phase 0");
    expect(response.text).toContain("Phase 0.5");
    expect(response.text).toContain("Phase 1.0");
    expect(response.text).toContain("Phase 1.1");
    expect(response.text).toContain("Phase 1.2");
    expect(response.text).toContain("Phase 1.5");
    expect(response.text).toContain("Completed Work");
    expect(response.text).toContain("Remaining Work");
    expect(response.text).toContain('href="/demo/settlement-center"');
    expect(response.text).toContain('href="/demo/wallet-outbox-monitor"');
  });

  it("GET /demo/settlement-center returns the settlement center demo page", async () => {
    const response = await request(app.getHttpServer()).get("/demo/settlement-center");
    expect(response.status).toBe(200);
    expect(response.text).toContain("Settlement Center Demo");
    expect(response.text).toContain("ศูนย์ตรวจผลและจ่ายรางวัล");
    expect(response.text).toContain("Eligible Tickets");
    expect(response.text).toContain("PAYOUT_CREDIT");
    expect(response.text).toContain("WALLET_CREDIT");
    expect(response.text).toContain("/api/health");
    expect(response.text).toContain("255480");
    expect(response.text).toContain("Manual Credit Paid");
    expect(response.text).toContain("Wallet Credit Pending");
    expect(response.text).toContain('href="/demo/wallet-outbox-monitor"');
  });

  it("GET /demo/wallet-outbox-monitor returns the wallet outbox monitor demo page", async () => {
    const response = await request(app.getHttpServer()).get("/demo/wallet-outbox-monitor");
    expect(response.status).toBe(200);
    expect(response.text).toContain("Wallet Outbox Monitor Demo");
    expect(response.text).toContain("ศูนย์ติดตาม Wallet Outbox");
    expect(response.text).toContain("WALLET_CREDIT Pending");
    expect(response.text).toContain("Duplicate Blocked");
    expect(response.text).toContain("Retry Safety");
    expect(response.text).toContain("DUPLICATE_BLOCKED");
    expect(response.text).toContain("/demo/settlement-center");
  });

  it("GET /v1/catalog/bet-types returns P0 bet types only", async () => {
    const response = await request(app.getHttpServer()).get("/v1/catalog/bet-types");
    expect(response.status).toBe(200);
    expect(response.body.bet_types.map((item: { code: string }) => item.code)).toEqual([
      "ONE_DIGIT",
      "TWO_STRAIGHT",
      "THREE_STRAIGHT",
      "FOUR_STRAIGHT",
      "FIVE_STRAIGHT",
      "SIX_STRAIGHT"
    ]);
  });

  it("POST admin round without auth/role is denied", async () => {
    const response = await request(app.getHttpServer()).post("/v1/admin/rounds").set(idempotency("round-no-auth")).send(roundBody("NO-AUTH"));
    expect(response.status).toBe(403);
  });

  it("POST admin mutation without Idempotency-Key returns 400", async () => {
    const response = await request(app.getHttpServer()).post("/v1/admin/rounds").set(adminHeaders).send(roundBody("NO-IDEM"));
    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe("Idempotency-Key header is required");
  });

  it("GET /v1/admin/settlements/:job_id requires admin header", async () => {
    const job = await createSettlementJob();
    const response = await request(app.getHttpServer()).get(`/v1/admin/settlements/${job.id}`);
    expect(response.status).toBe(403);
  });

  it("GET /v1/admin/settlements/:job_id returns a safe settlement job status response", async () => {
    const job = await createSettlementJob();
    const response = await request(app.getHttpServer()).get(`/v1/admin/settlements/${job.id}`).set(adminHeaders);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      settlement_job_id: job.id,
      round_id: job.round_id,
      status: "SUCCEEDED",
      progress_total: 2,
      progress_done: 2,
      winners_found: 1,
      payouts_succeeded: 1,
      payouts_failed: 0,
      summary: {
        scanned_count: 1,
        claimed_count: 1,
        processed_count: 1,
        succeeded_count: 1,
        failed_count: 0,
        unknown_count: 0,
        retried_count: 0,
        skipped_count: 0,
        stale_recovered_count: 0
      },
      created_at: expect.any(String),
      updated_at: expect.any(String)
    });
    expect(JSON.stringify(response.body)).not.toContain("must-not-return");
    expect(JSON.stringify(response.body)).not.toContain("secret");
  });

  it("GET /v1/admin/settlements/:job_id returns 404 for a missing settlement job", async () => {
    const response = await request(app.getHttpServer()).get("/v1/admin/settlements/00000000-0000-0000-0000-000000000000").set(adminHeaders);
    expect(response.status).toBe(404);
  });

  it("GET /v1/admin/audit-logs requires admin header", async () => {
    const response = await request(app.getHttpServer()).get("/v1/admin/audit-logs");
    expect(response.status).toBe(403);
  });

  it("GET /v1/admin/audit-logs returns existing audit logs with an items array and action", async () => {
    await createAuditLog({ action: "MANUAL_CREDIT_TOPUP" });
    const response = await request(app.getHttpServer()).get("/v1/admin/audit-logs").set(adminHeaders);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      items: [
        expect.objectContaining({
          action: "MANUAL_CREDIT_TOPUP",
          object_type: "credit_account",
          object_id: "credit-account-1"
        })
      ],
      limit: 20
    });
    expect(Array.isArray(response.body.items)).toBe(true);
  });

  it("GET /v1/admin/audit-logs supports limit query", async () => {
    await createAuditLog({ action: "OLDER_AUDIT", created_at: new Date("2026-05-12T01:00:00.000Z") });
    await createAuditLog({ action: "NEWER_AUDIT", created_at: new Date("2026-05-12T02:00:00.000Z") });
    const response = await request(app.getHttpServer()).get("/v1/admin/audit-logs?limit=1").set(adminHeaders);

    expect(response.status).toBe(200);
    expect(response.body.limit).toBe(1);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].action).toBe("NEWER_AUDIT");
  });

  it("GET /v1/admin/audit-logs rejects invalid limit", async () => {
    const response = await request(app.getHttpServer()).get("/v1/admin/audit-logs?limit=not-a-number").set(adminHeaders);
    expect(response.status).toBe(400);
  });

  it("GET /v1/admin/audit-logs does not leak secret token or password fields", async () => {
    await createAuditLog({
      action: "SENSITIVE_AUDIT",
      before: {
        password: "must-not-return",
        token: "must-not-return",
        public_check_token: "must-not-return",
        secret: "must-not-return"
      },
      after: {
        password_hash: "must-not-return",
        temporary_password: "must-not-return",
        authorization: "must-not-return",
        credential: "must-not-return",
        api_key: "must-not-return"
      }
    });
    const response = await request(app.getHttpServer()).get("/v1/admin/audit-logs").set(adminHeaders);

    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain("must-not-return");
    expect(JSON.stringify(response.body)).not.toContain("password");
    expect(JSON.stringify(response.body)).not.toContain("token");
    expect(JSON.stringify(response.body)).not.toContain("public_check_token");
    expect(JSON.stringify(response.body)).not.toContain("secret");
    expect(JSON.stringify(response.body)).not.toContain("authorization");
    expect(JSON.stringify(response.body)).not.toContain("credential");
    expect(JSON.stringify(response.body)).not.toContain("api_key");
  });

  it("PATCH /v1/admin/manual/users/:user_id/status requires admin header", async () => {
    const user = await createManualUser(app, "status-no-auth");
    const response = await request(app.getHttpServer())
      .patch(`/v1/admin/manual/users/${user.body.user.id}/status`)
      .send({ status: "SUSPENDED", reason_code: "RISK_REVIEW", note: "temporary review" });

    expect(response.status).toBe(403);
  });

  it("PATCH /v1/admin/manual/users/:user_id/status suspends an existing manual user with a safe response", async () => {
    const user = await createManualUser(app, "status-suspend");
    const response = await request(app.getHttpServer())
      .patch(`/v1/admin/manual/users/${user.body.user.id}/status`)
      .set(adminHeaders)
      .send({ status: "SUSPENDED", reason_code: "RISK_REVIEW", note: "ปิดชั่วคราวระหว่างตรวจสอบ" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      user_manual_id: user.body.user.id,
      username: user.body.user.username,
      display_name: user.body.user.display_name,
      status: "SUSPENDED",
      updated_at: expect.any(String)
    });
    expect(response.body.user_manual_id).toBe(user.body.user.id);
    expect(response.body.status).toBe("SUSPENDED");
    expect(response.body.password_hash).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain("password_hash");
    await expect(prisma.manualUser.findUniqueOrThrow({ where: { id: user.body.user.id } }).then((record) => record.status)).resolves.toBe("DISABLED");
    await expect(prisma.auditLog.count({ where: { action: "MANUAL_USER_STATUS_UPDATE", resource_id: user.body.user.id } })).resolves.toBe(1);

    const sameStatus = await request(app.getHttpServer())
      .patch(`/v1/admin/manual/users/${user.body.user.id}/status`)
      .set(adminHeaders)
      .send({ status: "SUSPENDED", reason_code: "RISK_REVIEW" });
    expect(sameStatus.status).toBe(200);
    expect(sameStatus.body.status).toBe("SUSPENDED");
    await expect(prisma.auditLog.count({ where: { action: "MANUAL_USER_STATUS_UPDATE", resource_id: user.body.user.id } })).resolves.toBe(1);
  });

  it("PATCH /v1/admin/manual/users/:user_id/status rejects invalid status", async () => {
    const user = await createManualUser(app, "status-invalid");
    const response = await request(app.getHttpServer())
      .patch(`/v1/admin/manual/users/${user.body.user.id}/status`)
      .set(adminHeaders)
      .send({ status: "DISABLED" });

    expect(response.status).toBe(400);
  });

  it("PATCH /v1/admin/manual/users/:user_id/status returns 404 for a missing manual user", async () => {
    const response = await request(app.getHttpServer())
      .patch("/v1/admin/manual/users/00000000-0000-0000-0000-000000000000/status")
      .set(adminHeaders)
      .send({ status: "SUSPENDED" });

    expect(response.status).toBe(404);
  });

  it("PATCH /v1/admin/manual/users/:user_id/status rejects mass assignment fields", async () => {
    const user = await createManualUser(app, "status-mass-assignment");
    const response = await request(app.getHttpServer())
      .patch(`/v1/admin/manual/users/${user.body.user.id}/status`)
      .set(adminHeaders)
      .send({
        status: "CLOSED",
        balance: 999999,
        password_hash: "client-hash",
        role: "admin"
      });

    expect(response.status).toBe(400);
    await expect(prisma.manualUser.findUniqueOrThrow({ where: { id: user.body.user.id } }).then((record) => record.status)).resolves.toBe("ENABLED");
  });

  it("same Idempotency-Key and same body returns same response", async () => {
    const body = roundBody("IDEM-SAME");
    const first = await request(app.getHttpServer()).post("/v1/admin/rounds").set(adminHeaders).set(idempotency("idem-same")).send(body);
    const second = await request(app.getHttpServer()).post("/v1/admin/rounds").set(adminHeaders).set(idempotency("idem-same")).send(body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
  });

  it("same Idempotency-Key and different body returns 409", async () => {
    const first = await request(app.getHttpServer()).post("/v1/admin/rounds").set(adminHeaders).set(idempotency("idem-conflict")).send(roundBody("IDEM-A"));
    const second = await request(app.getHttpServer()).post("/v1/admin/rounds").set(adminHeaders).set(idempotency("idem-conflict")).send(roundBody("IDEM-B"));
    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
  });
});
