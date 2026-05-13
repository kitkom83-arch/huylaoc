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

function roundBody(code: string, status: "OPEN" | "DRAFT" = "OPEN") {
  return {
    round_code: code,
    opens_at: "2026-05-12T01:00:00.000Z",
    closes_at: "2026-05-12T02:00:00.000Z",
    draws_at: "2026-05-12T02:00:00.000Z",
    status
  };
}

async function createRound(app: NestFastifyApplication, code: string, status: "OPEN" | "DRAFT" = "OPEN") {
  const response = await request(app.getHttpServer())
    .post("/v1/admin/rounds")
    .set(adminHeaders)
    .set(idempotency(`round-${code}`))
    .send(roundBody(code, status));
  expect(response.status).toBe(201);
  return response.body.round;
}

async function createManualUser(app: NestFastifyApplication, suffix: string) {
  const response = await request(app.getHttpServer())
    .post("/v1/admin/manual/users")
    .set(adminHeaders)
    .set(idempotency(`user-${suffix}`))
    .send({ username: `ticket_user_${suffix}`, display_name: "Ticket User", password: "strong-password" });
  expect(response.status).toBe(201);
  return response.body.user;
}

async function topup(app: NestFastifyApplication, userId: string, amount = 100) {
  const response = await request(app.getHttpServer())
    .post("/v1/admin/manual/credits/topup")
    .set(adminHeaders)
    .set(idempotency(`topup-${userId}-${amount}`))
    .send({ manual_user_id: userId, amount, reason: "test topup" });
  expect(response.status).toBe(201);
}

async function createManualQuote(app: NestFastifyApplication, input: { roundId: string; userId: string; key?: string; stake?: number }) {
  return request(app.getHttpServer())
    .post("/v1/quotes")
    .set(idempotency(input.key ?? `quote-${input.roundId}-${input.userId}`))
    .send({
      round_id: input.roundId,
      payment_mode: "MANUAL_CREDIT",
      currency_code: "THB",
      user_manual_id: input.userId,
      customer_ref: "counter-1",
      items: [{ bet_type: "TWO_STRAIGHT", selection: "12", stake: input.stake ?? 10 }]
    });
}

describe("quote and ticket lifecycle", () => {
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

  it("creates quote from open round, computes totals, expiry, normalized items, and rule snapshot", async () => {
    const round = await createRound(app, "QUOTE-OPEN");
    const user = await createManualUser(app, "quote_open");

    const response = await createManualQuote(app, { roundId: round.id, userId: user.id, stake: 10 });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      status: "CREATED",
      round_id: round.id,
      payment_mode: "MANUAL_CREDIT",
      currency_code: "THB",
      stake_total: 10,
      potential_payout_total: 900
    });
    expect(response.body.expires_at).toBeTruthy();
    expect(response.body.items[0]).toMatchObject({
      line_no: 1,
      bet_type: "TWO_STRAIGHT",
      selection_raw: "12",
      selection_norm: "12",
      stake: 10,
      odds: 90,
      potential_payout: 900
    });

    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: response.body.quote_id } });
    const snapshot = quote.quote_snapshot as { items: Array<{ rule_snapshot: unknown; selection_norm: string }> };
    expect(snapshot.items[0].selection_norm).toBe("12");
    expect(snapshot.items[0].rule_snapshot).toMatchObject({ outcome_rule: "tail2", digits: 2 });
  });

  it("rejects quote when round is closed", async () => {
    const round = await createRound(app, "QUOTE-CLOSED");
    const user = await createManualUser(app, "quote_closed");
    await prisma.round.update({ where: { id: round.id }, data: { status: "CLOSED" } });

    const response = await createManualQuote(app, { roundId: round.id, userId: user.id });

    expect(response.status).toBe(409);
  });

  it("rejects invalid bet_type, invalid selection length, and stake <= 0", async () => {
    const round = await createRound(app, "QUOTE-INVALIDS");
    const user = await createManualUser(app, "quote_invalids");
    const base = {
      round_id: round.id,
      payment_mode: "MANUAL_CREDIT",
      currency_code: "THB",
      user_manual_id: user.id
    };

    const invalidType = await request(app.getHttpServer())
      .post("/v1/quotes")
      .set(idempotency("quote-invalid-type"))
      .send({ ...base, items: [{ bet_type: "TWO_BOX", selection: "12", stake: 10 }] });
    const invalidLength = await request(app.getHttpServer())
      .post("/v1/quotes")
      .set(idempotency("quote-invalid-length"))
      .send({ ...base, items: [{ bet_type: "TWO_STRAIGHT", selection: "123", stake: 10 }] });
    const invalidStake = await request(app.getHttpServer())
      .post("/v1/quotes")
      .set(idempotency("quote-invalid-stake"))
      .send({ ...base, items: [{ bet_type: "TWO_STRAIGHT", selection: "12", stake: 0 }] });

    expect(invalidType.status).toBe(400);
    expect(invalidLength.status).toBe(400);
    expect(invalidStake.status).toBe(400);
  });

  it("requires Idempotency-Key for confirm", async () => {
    const response = await request(app.getHttpServer()).post("/v1/tickets/confirm").send({ quote_id: "missing" });
    expect(response.status).toBe(400);
  });

  it("blocks expired quote, already used quote, and round closed after quote", async () => {
    const round = await createRound(app, "CONFIRM-BLOCKS");
    const user = await createManualUser(app, "confirm_blocks");
    await topup(app, user.id, 100);

    const expiredQuote = await createManualQuote(app, { roundId: round.id, userId: user.id, key: "expired-quote" });
    await prisma.quote.update({ where: { id: expiredQuote.body.quote_id }, data: { expires_at: new Date(Date.now() - 1000) } });
    const expired = await request(app.getHttpServer()).post("/v1/tickets/confirm").set(idempotency("confirm-expired")).send({ quote_id: expiredQuote.body.quote_id });
    expect(expired.status).toBe(409);

    const usedQuote = await createManualQuote(app, { roundId: round.id, userId: user.id, key: "used-quote" });
    const first = await request(app.getHttpServer()).post("/v1/tickets/confirm").set(idempotency("confirm-used-first")).send({ quote_id: usedQuote.body.quote_id });
    const second = await request(app.getHttpServer()).post("/v1/tickets/confirm").set(idempotency("confirm-used-second")).send({ quote_id: usedQuote.body.quote_id });
    expect(first.status).toBe(201);
    expect(second.status).toBe(409);

    const closedQuote = await createManualQuote(app, { roundId: round.id, userId: user.id, key: "closed-after-quote" });
    await prisma.round.update({ where: { id: round.id }, data: { status: "CLOSED" } });
    const closed = await request(app.getHttpServer()).post("/v1/tickets/confirm").set(idempotency("confirm-round-closed")).send({ quote_id: closedQuote.body.quote_id });
    expect(closed.status).toBe(409);
  });

  it("MANUAL_CREDIT confirm debits once, creates ticket/items, stores token hash only, and is idempotent", async () => {
    const round = await createRound(app, "MANUAL-CONFIRM");
    const user = await createManualUser(app, "manual_confirm");
    await topup(app, user.id, 100);
    const quote = await createManualQuote(app, { roundId: round.id, userId: user.id, key: "manual-confirm-quote" });

    const first = await request(app.getHttpServer()).post("/v1/tickets/confirm").set(idempotency("manual-confirm")).send({ quote_id: quote.body.quote_id });
    const replay = await request(app.getHttpServer()).post("/v1/tickets/confirm").set(idempotency("manual-confirm")).send({ quote_id: quote.body.quote_id });
    const conflict = await request(app.getHttpServer()).post("/v1/tickets/confirm").set(idempotency("manual-confirm")).send({ quote_id: quote.body.quote_id, extra: true });

    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.body.ticket_no).toBe(first.body.ticket_no);
    expect(replay.body.public_check_token).toBe(first.body.public_check_token);
    expect(conflict.status).toBe(400);
    expect(first.body.public_check_token).toBeTruthy();
    expect(first.body.status).toBe("CONFIRMED");
    expect(first.body.funding_status).toBe("DEBITED");
    expect(first.body.settlement_status).toBe("PENDING");
    expect(first.body.payout_status).toBe("NOT_REQUIRED");

    await expect(prisma.creditAccount.findUniqueOrThrow({ where: { manual_user_id: user.id } }).then((account) => Number(account.balance))).resolves.toBe(90);
    await expect(prisma.creditLedger.count({ where: { type: "BET_DEBIT" } })).resolves.toBe(1);
    await expect(prisma.ticket.count()).resolves.toBe(1);
    await expect(prisma.ticketItem.count()).resolves.toBe(1);
    await expect(prisma.auditLog.count({ where: { action: "TICKET_CONFIRM" } })).resolves.toBe(1);

    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { ticket_no: first.body.ticket_no } });
    expect(ticket.public_check_token_hash).toBeTruthy();
    expect(ticket.public_check_token_hash).not.toBe(first.body.public_check_token);
    expect(JSON.stringify(ticket)).not.toContain(first.body.public_check_token);
    const idem = await prisma.idempotencyKey.findFirstOrThrow({ where: { scope: "tickets:confirm", idempotency_key: "manual-confirm" } });
    expect(JSON.stringify(idem.response_body)).not.toContain(first.body.public_check_token);
    expect(JSON.stringify(idem.response_body)).not.toContain("public_check_token_hash");
    const item = await prisma.ticketItem.findFirstOrThrow({ where: { ticket_id: ticket.id } });
    expect(Number(item.odds_value)).toBe(90);
    expect(item.rule_snapshot).toMatchObject({ outcome_rule: "tail2" });

    const replayCheck = await request(app.getHttpServer())
      .post("/v1/tickets/check")
      .send({ ticket_no: replay.body.ticket_no, public_check_token: replay.body.public_check_token });
    expect(replayCheck.status).toBe(200);
    expect(JSON.stringify(replayCheck.body)).not.toContain(ticket.public_check_token_hash);
  });

  it("same Idempotency-Key with different valid body returns 409", async () => {
    const round = await createRound(app, "IDEM-DIFF");
    const user = await createManualUser(app, "idem_diff");
    await topup(app, user.id, 100);
    const quoteA = await createManualQuote(app, { roundId: round.id, userId: user.id, key: "idem-diff-a" });
    const quoteB = await createManualQuote(app, { roundId: round.id, userId: user.id, key: "idem-diff-b" });

    const first = await request(app.getHttpServer()).post("/v1/tickets/confirm").set(idempotency("confirm-diff")).send({ quote_id: quoteA.body.quote_id });
    const second = await request(app.getHttpServer()).post("/v1/tickets/confirm").set(idempotency("confirm-diff")).send({ quote_id: quoteB.body.quote_id });

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
  });

  it("MANUAL_CREDIT insufficient credit returns 422 and creates no ticket", async () => {
    const round = await createRound(app, "INSUFFICIENT");
    const user = await createManualUser(app, "insufficient");
    const quote = await createManualQuote(app, { roundId: round.id, userId: user.id, key: "insufficient-quote" });

    const response = await request(app.getHttpServer()).post("/v1/tickets/confirm").set(idempotency("insufficient-confirm")).send({ quote_id: quote.body.quote_id });

    expect(response.status).toBe(422);
    await expect(prisma.ticket.count()).resolves.toBe(0);
    await expect(prisma.creditLedger.count()).resolves.toBe(0);
  });

  it("EXTERNAL_WALLET confirm creates wallet_outbox and no ledger debit", async () => {
    const round = await createRound(app, "EXTERNAL-CONFIRM");
    const quote = await request(app.getHttpServer())
      .post("/v1/quotes")
      .set(idempotency("external-quote"))
      .send({
        round_id: round.id,
        payment_mode: "EXTERNAL_WALLET",
        currency_code: "THB",
        wallet_account_ref: "wallet-123",
        items: [{ bet_type: "ONE_DIGIT", selection: "7", stake: 5 }]
      });
    expect(quote.status).toBe(201);

    const response = await request(app.getHttpServer()).post("/v1/tickets/confirm").set(idempotency("external-confirm")).send({ quote_id: quote.body.quote_id });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe("PENDING_FUNDING");
    expect(response.body.funding_status).toBe("PENDING");
    await expect(prisma.walletOutbox.count({ where: { type: "WALLET_DEBIT" } })).resolves.toBe(1);
    await expect(prisma.creditLedger.count()).resolves.toBe(0);
  });

  it("concurrent confirm for same quote does not create duplicate tickets", async () => {
    const round = await createRound(app, "CONCURRENT");
    const user = await createManualUser(app, "concurrent");
    await topup(app, user.id, 100);
    const quote = await createManualQuote(app, { roundId: round.id, userId: user.id, key: "concurrent-quote" });

    const responses = await Promise.all([
      request(app.getHttpServer()).post("/v1/tickets/confirm").set(idempotency("concurrent-a")).send({ quote_id: quote.body.quote_id }),
      request(app.getHttpServer()).post("/v1/tickets/confirm").set(idempotency("concurrent-b")).send({ quote_id: quote.body.quote_id })
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    await expect(prisma.ticket.count()).resolves.toBe(1);
    await expect(prisma.creditLedger.count({ where: { type: "BET_DEBIT" } })).resolves.toBe(1);
  });

  it("ticket check returns summary for correct token, rejects wrong token and ticket_no only without leaking sensitive fields", async () => {
    const round = await createRound(app, "CHECK");
    const user = await createManualUser(app, "check");
    await topup(app, user.id, 100);
    const quote = await createManualQuote(app, { roundId: round.id, userId: user.id, key: "check-quote" });
    const confirm = await request(app.getHttpServer()).post("/v1/tickets/confirm").set(idempotency("check-confirm")).send({ quote_id: quote.body.quote_id });

    const good = await request(app.getHttpServer())
      .post("/v1/tickets/check")
      .send({ ticket_no: confirm.body.ticket_no, public_check_token: confirm.body.public_check_token });
    const wrong = await request(app.getHttpServer())
      .post("/v1/tickets/check")
      .send({ ticket_no: confirm.body.ticket_no, public_check_token: "wrong" });
    const missing = await request(app.getHttpServer()).post("/v1/tickets/check").send({ ticket_no: confirm.body.ticket_no });

    expect(good.status).toBe(200);
    expect(good.body).toMatchObject({ ticket_no: confirm.body.ticket_no, round_code: "CHECK", status: "CONFIRMED" });
    expect(JSON.stringify(good.body)).not.toContain("public_check_token_hash");
    expect(good.body.round_id).toBeUndefined();
    expect(good.body.user_manual_id).toBeUndefined();
    expect(wrong.status).toBe(401);
    expect(JSON.stringify(wrong.body)).not.toContain("items");
    expect(missing.status).toBe(400);
  });

  it("admin ticket list is denied by default, lists tickets, and filters", async () => {
    const round = await createRound(app, "ADMIN-LIST");
    const user = await createManualUser(app, "admin_list");
    await topup(app, user.id, 100);
    const quote = await createManualQuote(app, { roundId: round.id, userId: user.id, key: "admin-list-quote" });
    const confirm = await request(app.getHttpServer()).post("/v1/tickets/confirm").set(idempotency("admin-list-confirm")).send({ quote_id: quote.body.quote_id });

    const denied = await request(app.getHttpServer()).get("/v1/admin/tickets");
    const listed = await request(app.getHttpServer()).get("/v1/admin/tickets").set(adminHeaders);
    const filtered = await request(app.getHttpServer()).get(`/v1/admin/tickets?ticket_no=${confirm.body.ticket_no}&funding_status=DEBITED&user_manual_id=${user.id}`).set(adminHeaders);

    expect(denied.status).toBe(403);
    expect(listed.status).toBe(200);
    expect(listed.body.tickets).toHaveLength(1);
    expect(JSON.stringify(listed.body)).not.toContain("public_check_token_hash");
    expect(filtered.status).toBe(200);
    expect(filtered.body.tickets).toHaveLength(1);
  });

  it("admin manual ticket entry debits credit and writes ledger/audit", async () => {
    const round = await createRound(app, "ADMIN-MANUAL");
    const user = await createManualUser(app, "admin_manual");
    await topup(app, user.id, 100);

    const response = await request(app.getHttpServer())
      .post("/v1/admin/manual/tickets")
      .set(adminHeaders)
      .set(idempotency("admin-manual-ticket"))
      .send({
        user_manual_id: user.id,
        round_id: round.id,
        currency_code: "THB",
        note: "counter entry",
        items: [{ bet_type: "THREE_STRAIGHT", selection: "123", stake: 10 }]
      });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe("CONFIRMED");
    await expect(prisma.creditAccount.findUniqueOrThrow({ where: { manual_user_id: user.id } }).then((account) => Number(account.balance))).resolves.toBe(90);
    await expect(prisma.creditLedger.count({ where: { type: "BET_DEBIT" } })).resolves.toBe(1);
    await expect(prisma.auditLog.count({ where: { action: "ADMIN_MANUAL_TICKET_ENTRY" } })).resolves.toBe(1);
  });

  it("rejects mass assignment attempts for ticket lifecycle status and sensitive fields", async () => {
    const round = await createRound(app, "MASS-TICKET");
    const user = await createManualUser(app, "mass_ticket");
    const quoteAttempt = await request(app.getHttpServer())
      .post("/v1/quotes")
      .set(idempotency("mass-quote"))
      .send({
        round_id: round.id,
        payment_mode: "MANUAL_CREDIT",
        currency_code: "THB",
        user_manual_id: user.id,
        balance: 99999,
        role: "admin",
        password_hash: "client-hash",
        funding_status: "DEBITED",
        settlement_status: "SETTLED",
        payout_status: "PAID",
        items: [{ bet_type: "ONE_DIGIT", selection: "1", stake: 1 }]
      });
    const adminAttempt = await request(app.getHttpServer())
      .post("/v1/admin/manual/tickets")
      .set(adminHeaders)
      .set(idempotency("mass-admin-ticket"))
      .send({
        user_manual_id: user.id,
        round_id: round.id,
        currency_code: "THB",
        funding_status: "DEBITED",
        payout_status: "PAID",
        settlement_status: "SETTLED",
        items: [{ bet_type: "ONE_DIGIT", selection: "1", stake: 1 }]
      });

    expect(quoteAttempt.status).toBe(400);
    expect(adminAttempt.status).toBe(400);
    await expect(prisma.ticket.count()).resolves.toBe(0);
  });
});
