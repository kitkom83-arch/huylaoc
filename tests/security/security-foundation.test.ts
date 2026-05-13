import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createNestApp, AuditLogRepository, CreditLedgerRepository } from "../../services/lottery-api/dist/index.js";
import { closeDatabase, resetDatabase } from "../helpers/database.js";

const adminHeaders = {
  "x-admin-id": "admin-test",
  "x-admin-role": "admin"
};

describe("security foundation", () => {
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

  it("rejects mass assignment attempts for balance, role, and password_hash", async () => {
    const response = await request(app.getHttpServer())
      .post("/v1/admin/manual/users")
      .set(adminHeaders)
      .set({ "Idempotency-Key": "mass-assignment" })
      .send({
        username: "mass_user",
        display_name: "Mass User",
        password: "strong-password",
        balance: 999999,
        role: "admin",
        password_hash: "client-hash"
      });

    expect(response.status).toBe(400);
  });

  it("append-only repositories expose no update or delete app methods", () => {
    const auditMethods = Object.getOwnPropertyNames(AuditLogRepository.prototype);
    const ledgerMethods = Object.getOwnPropertyNames(CreditLedgerRepository.prototype);
    expect(auditMethods).not.toContain("update");
    expect(auditMethods).not.toContain("delete");
    expect(ledgerMethods).not.toContain("update");
    expect(ledgerMethods).not.toContain("delete");
  });
});
