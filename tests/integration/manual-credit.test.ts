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

async function createManualUser(app: NestFastifyApplication, key = "manual-user") {
  return request(app.getHttpServer())
    .post("/v1/admin/manual/users")
    .set(adminHeaders)
    .set(idempotency(key))
    .send({ username: `user_${key}`, display_name: "Manual User", password: "strong-password" });
}

describe("manual credit foundation", () => {
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

  it("creates manual user with credit account and never returns password_hash", async () => {
    const response = await createManualUser(app);
    expect(response.status).toBe(201);
    expect(response.body.credit_account.balance).toBe(0);
    expect(response.body.user.password_hash).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain("password_hash");
  });

  it("topup writes ledger and audit", async () => {
    const user = await createManualUser(app, "topup-user");
    const userId = user.body.user.id;
    const response = await request(app.getHttpServer())
      .post("/v1/admin/manual/credits/topup")
      .set(adminHeaders)
      .set(idempotency("topup"))
      .send({ manual_user_id: userId, amount: 100, reason: "cash desk topup" });

    expect(response.status).toBe(201);
    await expect(prisma.creditLedger.count({ where: { type: "TOPUP", amount_delta: 100 } })).resolves.toBe(1);
    await expect(prisma.auditLog.count({ where: { action: "MANUAL_CREDIT_TOPUP" } })).resolves.toBe(1);
    await expect(prisma.creditAccount.findUniqueOrThrow({ where: { manual_user_id: userId } }).then((account) => Number(account.balance))).resolves.toBe(100);
  });

  it("deduct writes ledger and audit", async () => {
    const user = await createManualUser(app, "deduct-user");
    const userId = user.body.user.id;
    await request(app.getHttpServer()).post("/v1/admin/manual/credits/topup").set(adminHeaders).set(idempotency("deduct-topup")).send({ manual_user_id: userId, amount: 100, reason: "topup" });
    const response = await request(app.getHttpServer())
      .post("/v1/admin/manual/credits/deduct")
      .set(adminHeaders)
      .set(idempotency("deduct"))
      .send({ manual_user_id: userId, amount: 40, reason: "manual correction" });

    expect(response.status).toBe(201);
    await expect(prisma.creditLedger.count({ where: { type: "DEDUCT", amount_delta: -40 } })).resolves.toBe(1);
    await expect(prisma.auditLog.count({ where: { action: "MANUAL_CREDIT_DEDUCT" } })).resolves.toBe(1);
    await expect(prisma.creditAccount.findUniqueOrThrow({ where: { manual_user_id: userId } }).then((account) => Number(account.balance))).resolves.toBe(60);
  });

  it("deduct over balance fails", async () => {
    const user = await createManualUser(app, "over-user");
    const response = await request(app.getHttpServer())
      .post("/v1/admin/manual/credits/deduct")
      .set(adminHeaders)
      .set(idempotency("over-deduct"))
      .send({ manual_user_id: user.body.user.id, amount: 1, reason: "over" });

    expect(response.status).toBe(409);
    await expect(prisma.creditAccount.findUniqueOrThrow({ where: { manual_user_id: user.body.user.id } }).then((account) => Number(account.balance))).resolves.toBe(0);
    await expect(prisma.creditLedger.count()).resolves.toBe(0);
  });
});
