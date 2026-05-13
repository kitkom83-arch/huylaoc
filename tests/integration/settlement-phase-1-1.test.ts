import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { isTicketEligibleForSettlement } from "../../packages/domain/dist/index.js";
import { createNestApp } from "../../services/lottery-api/dist/index.js";
import { SettlementPreflightService } from "../../services/settlement-worker/dist/main.js";
import { WalletOutboxStateService } from "../../services/wallet-outbox-worker/dist/main.js";
import { closeDatabase, prisma, resetDatabase } from "../helpers/database.js";

const adminHeaders = {
  "x-admin-id": "admin-test",
  "x-admin-role": "admin"
};

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
  return response.body.round;
}

async function createManualTicket(app: NestFastifyApplication, roundId: string, suffix: string) {
  const user = await request(app.getHttpServer())
    .post("/v1/admin/manual/users")
    .set(adminHeaders)
    .set(idempotency(`user-${suffix}`))
    .send({ username: `phase_user_${suffix}`, display_name: "Phase User", password: "strong-password" });
  expect(user.status).toBe(201);

  const topup = await request(app.getHttpServer())
    .post("/v1/admin/manual/credits/topup")
    .set(adminHeaders)
    .set(idempotency(`topup-${suffix}`))
    .send({ manual_user_id: user.body.user.id, amount: 100, reason: "test topup" });
  expect(topup.status).toBe(201);

  const quote = await request(app.getHttpServer())
    .post("/v1/quotes")
    .set(idempotency(`manual-quote-${suffix}`))
    .send({
      round_id: roundId,
      payment_mode: "MANUAL_CREDIT",
      currency_code: "THB",
      user_manual_id: user.body.user.id,
      items: [{ bet_type: "TWO_STRAIGHT", selection: "12", stake: 10 }]
    });
  expect(quote.status).toBe(201);

  const confirm = await request(app.getHttpServer())
    .post("/v1/tickets/confirm")
    .set(idempotency(`manual-confirm-${suffix}`))
    .send({ quote_id: quote.body.quote_id });
  expect(confirm.status).toBe(201);
  return prisma.ticket.findUniqueOrThrow({ where: { ticket_no: confirm.body.ticket_no } });
}

async function createExternalTicket(app: NestFastifyApplication, roundId: string, suffix: string) {
  const quote = await request(app.getHttpServer())
    .post("/v1/quotes")
    .set(idempotency(`external-quote-${suffix}`))
    .send({
      round_id: roundId,
      payment_mode: "EXTERNAL_WALLET",
      currency_code: "THB",
      wallet_account_ref: `wallet-${suffix}`,
      external_txn_ref: `txn-${suffix}`,
      items: [{ bet_type: "ONE_DIGIT", selection: "7", stake: 5 }]
    });
  expect(quote.status).toBe(201);

  const confirm = await request(app.getHttpServer())
    .post("/v1/tickets/confirm")
    .set(idempotency(`external-confirm-${suffix}`))
    .send({ quote_id: quote.body.quote_id });
  expect(confirm.status).toBe(201);

  const ticket = await prisma.ticket.findUniqueOrThrow({ where: { ticket_no: confirm.body.ticket_no } });
  const outbox = await prisma.walletOutbox.findFirstOrThrow({ where: { ticket_id: ticket.id, type: "WALLET_DEBIT" } });
  return { ticket, outbox };
}

describe("settlement Phase 1.1 preconditions", () => {
  let app: NestFastifyApplication;
  let walletOutbox: WalletOutboxStateService;
  let settlementPreflight: SettlementPreflightService;

  beforeEach(async () => {
    process.env.NODE_ENV = "test";
    await resetDatabase();
    app = await createNestApp();
    walletOutbox = new WalletOutboxStateService(prisma);
    settlementPreflight = new SettlementPreflightService(prisma);
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("applies settlement eligibility rules from ticket status, settlement status, and funding status", async () => {
    const round = await createRound(app, "ELIGIBILITY");
    const manualTicket = await createManualTicket(app, round.id, "eligible");
    const pendingExternal = await createExternalTicket(app, round.id, "pending");
    const failedExternal = await createExternalTicket(app, round.id, "failed");
    const unknownExternal = await createExternalTicket(app, round.id, "unknown");

    await walletOutbox.markWalletOutboxFailed(failedExternal.outbox.id);
    await walletOutbox.markWalletOutboxUnknown(unknownExternal.outbox.id);
    const settledManualTicket = await prisma.ticket.update({ where: { id: manualTicket.id }, data: { settlement_status: "SETTLED" } });

    expect(isTicketEligibleForSettlement(manualTicket)).toBe(true);
    expect(isTicketEligibleForSettlement(pendingExternal.ticket)).toBe(false);
    expect(isTicketEligibleForSettlement(await prisma.ticket.findUniqueOrThrow({ where: { id: failedExternal.ticket.id } }))).toBe(false);
    expect(isTicketEligibleForSettlement(await prisma.ticket.findUniqueOrThrow({ where: { id: unknownExternal.ticket.id } }))).toBe(false);
    expect(isTicketEligibleForSettlement(settledManualTicket)).toBe(false);
  });

  it("marks WALLET_DEBIT succeeded, updates funding, writes one audit, and makes the ticket eligible", async () => {
    const round = await createRound(app, "OUTBOX-SUCCESS");
    const { ticket, outbox } = await createExternalTicket(app, round.id, "success");

    const first = await walletOutbox.markWalletOutboxSucceeded(outbox.id);
    const replay = await walletOutbox.markWalletOutboxSucceeded(outbox.id);
    const updatedTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });

    expect(first).toMatchObject({ previous_status: "PENDING", status: "SUCCEEDED", changed: true });
    expect(replay).toMatchObject({ previous_status: "SUCCEEDED", status: "SUCCEEDED", changed: false });
    expect(updatedTicket.funding_status).toBe("SUCCEEDED");
    expect(updatedTicket.status).toBe("CONFIRMED");
    expect(isTicketEligibleForSettlement(updatedTicket)).toBe(true);
    await expect(prisma.auditLog.count({ where: { action: "WALLET_OUTBOX_STATUS_CHANGE", resource_id: outbox.id } })).resolves.toBe(1);
  });

  it("marks WALLET_DEBIT failed or unknown without making tickets eligible", async () => {
    const round = await createRound(app, "OUTBOX-BLOCKED");
    const failed = await createExternalTicket(app, round.id, "blocked-failed");
    const unknown = await createExternalTicket(app, round.id, "blocked-unknown");

    await walletOutbox.markWalletOutboxProcessing(failed.outbox.id);
    await walletOutbox.markWalletOutboxFailed(failed.outbox.id);
    await walletOutbox.markWalletOutboxUnknown(unknown.outbox.id);

    const failedTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: failed.ticket.id } });
    const unknownTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: unknown.ticket.id } });

    expect(failedTicket.funding_status).toBe("FAILED");
    expect(unknownTicket.funding_status).toBe("UNKNOWN");
    expect(isTicketEligibleForSettlement(failedTicket)).toBe(false);
    expect(isTicketEligibleForSettlement(unknownTicket)).toBe(false);
    await expect(prisma.auditLog.count({ where: { action: "WALLET_OUTBOX_STATUS_CHANGE" } })).resolves.toBe(3);
  });

  it("settlement preflight counts eligible and skipped tickets and can be retried safely", async () => {
    const round = await createRound(app, "PREFLIGHT");
    await createManualTicket(app, round.id, "preflight-manual");
    await createExternalTicket(app, round.id, "preflight-pending");
    const failed = await createExternalTicket(app, round.id, "preflight-failed");
    const unknown = await createExternalTicket(app, round.id, "preflight-unknown");
    await walletOutbox.markWalletOutboxFailed(failed.outbox.id);
    await walletOutbox.markWalletOutboxUnknown(unknown.outbox.id);

    const result = await request(app.getHttpServer())
      .post("/v1/admin/results")
      .set(adminHeaders)
      .set(idempotency("preflight-result"))
      .send({ round_id: round.id, result_6d: "255480" });
    expect(result.status).toBe(201);

    const first = await settlementPreflight.preflightSettlementJob(result.body.settlement_job.id);
    const second = await settlementPreflight.preflightSettlementJob(result.body.settlement_job.id);

    expect(first).toMatchObject({
      round_id: round.id,
      eligible_count: 1,
      skipped_count: 3,
      ticket_count: 4
    });
    expect(second).toEqual(first);
    await expect(prisma.settlementJob.findUniqueOrThrow({ where: { id: result.body.settlement_job.id } }).then((job) => job.status)).resolves.toBe("PENDING");
  });
});
