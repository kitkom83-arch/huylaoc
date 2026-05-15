import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createNestApp } from "../../services/lottery-api/dist/index.js";
import { closeDatabase, resetDatabase } from "../helpers/database.js";

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
  });

  it("GET /demo/settlement-center returns the settlement center demo page", async () => {
    const response = await request(app.getHttpServer()).get("/demo/settlement-center");
    expect(response.status).toBe(200);
    expect(response.text).toContain("Settlement Center Demo");
    expect(response.text).toContain("ศูนย์ตรวจผลและจ่ายรางวัล");
    expect(response.text).toContain("Eligible Tickets");
    expect(response.text).toContain("PAYOUT_CREDIT");
    expect(response.text).toContain("WALLET_CREDIT");
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
