import { execFileSync } from "node:child_process";
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

async function createManualUser(app: NestFastifyApplication, key: string) {
  return request(app.getHttpServer())
    .post("/v1/admin/manual/users")
    .set(adminHeaders)
    .set(idempotency(`user-${key}`))
    .send({ username: `user_${key}`, display_name: "Manual User", password: "strong-password" });
}

describe("Prisma persistence and transactions", () => {
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

  it("migrations run successfully and seed creates P0 bet types", async () => {
    execFileSync(process.execPath, ["scripts/db.mjs", "migrate"], { stdio: "pipe", env: process.env });
    execFileSync(process.execPath, ["scripts/db.mjs", "seed"], { stdio: "pipe", env: process.env });
    const codes = await prisma.betTypeCatalog.findMany({ orderBy: { digits: "asc" }, select: { code: true } });
    expect(codes.map((entry) => entry.code)).toEqual(["ONE_DIGIT", "TWO_STRAIGHT", "THREE_STRAIGHT", "FOUR_STRAIGHT", "FIVE_STRAIGHT", "SIX_STRAIGHT"]);
  });

  it("catalog reads seeded bet types from PostgreSQL", async () => {
    await prisma.betTypeCatalog.update({ where: { code: "ONE_DIGIT" }, data: { enabled: false } });
    const response = await request(app.getHttpServer()).get("/v1/catalog/bet-types");
    expect(response.status).toBe(200);
    expect(response.body.bet_types.map((item: { code: string }) => item.code)).toEqual(["TWO_STRAIGHT", "THREE_STRAIGHT", "FOUR_STRAIGHT", "FIVE_STRAIGHT", "SIX_STRAIGHT"]);
    await prisma.betTypeCatalog.update({ where: { code: "ONE_DIGIT" }, data: { enabled: true } });
  });

  it("manual user persists to DB with credit account and hidden password hash", async () => {
    const response = await createManualUser(app, "persist");
    expect(response.status).toBe(201);
    expect(response.body.user.password_hash).toBeUndefined();
    await expect(prisma.manualUser.count({ where: { id: response.body.user.id } })).resolves.toBe(1);
    await expect(prisma.creditAccount.count({ where: { manual_user_id: response.body.user.id } })).resolves.toBe(1);
  });

  it("topup and deduct idempotency changes balance only once", async () => {
    const user = await createManualUser(app, "idem_credit");
    const userId = user.body.user.id;
    const topupBody = { manual_user_id: userId, amount: 100, reason: "topup" };
    const firstTopup = await request(app.getHttpServer()).post("/v1/admin/manual/credits/topup").set(adminHeaders).set(idempotency("topup-once")).send(topupBody);
    const secondTopup = await request(app.getHttpServer()).post("/v1/admin/manual/credits/topup").set(adminHeaders).set(idempotency("topup-once")).send(topupBody);
    expect(secondTopup.body).toEqual(firstTopup.body);
    await expect(prisma.creditLedger.count({ where: { type: "TOPUP" } })).resolves.toBe(1);

    const deductBody = { manual_user_id: userId, amount: 40, reason: "deduct" };
    await request(app.getHttpServer()).post("/v1/admin/manual/credits/deduct").set(adminHeaders).set(idempotency("deduct-once")).send(deductBody);
    await request(app.getHttpServer()).post("/v1/admin/manual/credits/deduct").set(adminHeaders).set(idempotency("deduct-once")).send(deductBody);
    await expect(prisma.creditLedger.count({ where: { type: "DEDUCT" } })).resolves.toBe(1);
    await expect(prisma.creditAccount.findUniqueOrThrow({ where: { manual_user_id: userId } }).then((account) => Number(account.balance))).resolves.toBe(60);
  });

  it("same Idempotency-Key with different body returns 409 and validation failures are not cached", async () => {
    const bad = await request(app.getHttpServer()).post("/v1/admin/rounds").set(adminHeaders).set(idempotency("validation-not-cached")).send({ round_code: "BAD" });
    expect(bad.status).toBe(400);
    await expect(prisma.idempotencyKey.count({ where: { idempotency_key: "validation-not-cached" } })).resolves.toBe(0);

    const first = await request(app.getHttpServer()).post("/v1/admin/rounds").set(adminHeaders).set(idempotency("round-conflict")).send(roundBody("ROUND-A"));
    const second = await request(app.getHttpServer()).post("/v1/admin/rounds").set(adminHeaders).set(idempotency("round-conflict")).send(roundBody("ROUND-B"));
    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
  });

  it("result post creates result, settlement job, audit log, and is idempotent", async () => {
    const round = await request(app.getHttpServer()).post("/v1/admin/rounds").set(adminHeaders).set(idempotency("round-result")).send(roundBody("RESULT-ROUND"));
    const body = { round_id: round.body.round.id, result_6d: "255480" };
    const first = await request(app.getHttpServer()).post("/v1/admin/results").set(adminHeaders).set(idempotency("result-once")).send(body);
    const second = await request(app.getHttpServer()).post("/v1/admin/results").set(adminHeaders).set(idempotency("result-once")).send(body);
    expect(first.status).toBe(201);
    expect(second.body).toEqual(first.body);
    await expect(prisma.result.count({ where: { round_id: body.round_id } })).resolves.toBe(1);
    await expect(prisma.settlementJob.count({ where: { round_id: body.round_id } })).resolves.toBe(1);
    await expect(prisma.auditLog.count({ where: { action: "RESULT_POST" } })).resolves.toBe(1);
  });

  it("concurrent deduct cannot make balance negative", async () => {
    const user = await createManualUser(app, "concurrent");
    const userId = user.body.user.id;
    await request(app.getHttpServer()).post("/v1/admin/manual/credits/topup").set(adminHeaders).set(idempotency("concurrent-topup")).send({ manual_user_id: userId, amount: 50, reason: "topup" });

    const [first, second] = await Promise.all([
      request(app.getHttpServer()).post("/v1/admin/manual/credits/deduct").set(adminHeaders).set(idempotency("concurrent-deduct-a")).send({ manual_user_id: userId, amount: 40, reason: "deduct a" }),
      request(app.getHttpServer()).post("/v1/admin/manual/credits/deduct").set(adminHeaders).set(idempotency("concurrent-deduct-b")).send({ manual_user_id: userId, amount: 40, reason: "deduct b" })
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
    await expect(prisma.creditAccount.findUniqueOrThrow({ where: { manual_user_id: userId } }).then((account) => Number(account.balance))).resolves.toBe(10);
    await expect(prisma.creditLedger.count({ where: { type: "DEDUCT" } })).resolves.toBe(1);
  });
});
