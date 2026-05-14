import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { isTicketEligibleForSettlement } from "../../packages/domain/dist/index.js";
import { ScriptedMockWalletClient, WalletOutboxWorkerService, type MockWalletResult } from "../../services/wallet-outbox-worker/dist/main.js";
import { closeDatabase, prisma, resetDatabase } from "../helpers/database.js";

const baseDate = new Date("2026-05-14T00:00:00.000Z");

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

async function createQuote(roundId: string, suffix: string, stakeTotal = 10) {
  return prisma.quote.create({
    data: {
      quote_no: `Q-WALLET-${suffix}`,
      round_id: roundId,
      mode: "EXTERNAL_WALLET",
      customer_ref: `customer-${suffix}`,
      wallet_account_ref: `wallet-${suffix}`,
      external_txn_ref: `external-${suffix}`,
      stake_total: stakeTotal,
      potential_payout_total: stakeTotal * 9,
      currency: "THB",
      status: "USED",
      expires_at: new Date("2026-05-14T01:05:00.000Z"),
      request_hash: `hash-${suffix}`,
      quote_snapshot: { suffix }
    }
  });
}

async function createWalletTicket(input: {
  suffix: string;
  funding_status?: "PENDING" | "SUCCEEDED";
  ticket_status?: "PENDING_FUNDING" | "CONFIRMED" | "SETTLED";
  payout_status?: "NOT_REQUIRED" | "PENDING" | "SUCCEEDED" | "FAILED" | "UNKNOWN";
  stakeTotal?: number;
}) {
  const stakeTotal = input.stakeTotal ?? 10;
  const round = await createRound(`WALLET-${input.suffix}`);
  const quote = await createQuote(round.id, input.suffix, stakeTotal);
  return prisma.ticket.create({
    data: {
      ticket_no: `T-WALLET-${input.suffix}`,
      round_id: round.id,
      quote_id: quote.id,
      mode: "EXTERNAL_WALLET",
      customer_ref: `customer-${input.suffix}`,
      wallet_account_ref: quote.wallet_account_ref,
      external_txn_ref: quote.external_txn_ref,
      stake_total: stakeTotal,
      potential_payout_total: stakeTotal * 9,
      actual_payout_total: input.payout_status === "PENDING" ? stakeTotal * 9 : 0,
      funding_status: input.funding_status ?? "PENDING",
      settlement_status: input.ticket_status === "SETTLED" ? "WON" : "PENDING",
      payout_status: input.payout_status ?? "NOT_REQUIRED",
      status: input.ticket_status ?? "PENDING_FUNDING",
      idempotency_scope: "wallet-outbox-test",
      idempotency_key: `idem-${input.suffix}`,
      public_check_token_hash: `token-${input.suffix}`
    }
  });
}

async function createOutbox(input: {
  ticketId: string;
  suffix: string;
  type: "WALLET_DEBIT" | "WALLET_CREDIT";
  status?: "PENDING" | "SUCCEEDED" | "FAILED" | "UNKNOWN";
  amount?: number;
}) {
  const amountKey = input.type === "WALLET_DEBIT" ? "stake_total" : "payout_total";
  return prisma.walletOutbox.create({
    data: {
      type: input.type,
      status: input.status ?? "PENDING",
      operation_ref: `op-${input.suffix}`,
      ticket_id: input.ticketId,
      wallet_account_ref: `wallet-${input.suffix}`,
      external_txn_ref: `external-${input.suffix}`,
      payload: {
        ticket_no: `T-WALLET-${input.suffix}`,
        [amountKey]: input.amount ?? 10,
        currency_code: "THB"
      }
    }
  });
}

function workerWith(resultByOperationRef: Record<string, MockWalletResult>, options: { maxRetries?: number } = {}) {
  const client = new ScriptedMockWalletClient();
  for (const [operationRef, result] of Object.entries(resultByOperationRef)) {
    client.setOperationResult(operationRef, result);
  }
  return {
    client,
    worker: new WalletOutboxWorkerService(prisma, client, {
      now: () => baseDate,
      baseBackoffMs: 1_000,
      maxBackoffMs: 10_000,
      maxRetries: options.maxRetries ?? 3
    })
  };
}

async function auditCount(action: string, resourceId?: string): Promise<number> {
  return prisma.auditLog.count({ where: { action, ...(resourceId ? { resource_id: resourceId } : {}) } });
}

describe("wallet outbox worker Phase 1.6 hardening", () => {
  beforeEach(async () => {
    process.env.NODE_ENV = "test";
    await resetDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("pending WALLET_DEBIT succeeds and updates funding_status", async () => {
    const ticket = await createWalletTicket({ suffix: "DEBIT-SUCCESS" });
    const outbox = await createOutbox({ ticketId: ticket.id, suffix: "DEBIT-SUCCESS", type: "WALLET_DEBIT" });
    const { worker, client } = workerWith({});

    const report = await worker.processPendingOutboxRows();
    const updatedOutbox = await prisma.walletOutbox.findUniqueOrThrow({ where: { id: outbox.id } });
    const updatedTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });

    expect(report).toMatchObject({ processed: 1, succeeded: 1 });
    expect(client.callCount(outbox.operation_ref)).toBe(1);
    expect(updatedOutbox.status).toBe("SUCCEEDED");
    expect(updatedTicket.funding_status).toBe("SUCCEEDED");
    expect(updatedTicket.status).toBe("CONFIRMED");
    expect(isTicketEligibleForSettlement(updatedTicket)).toBe(true);
    await expect(auditCount("WALLET_DEBIT_SUCCEEDED", outbox.id)).resolves.toBe(1);
  });

  it("pending WALLET_DEBIT failed keeps ticket ineligible", async () => {
    const ticket = await createWalletTicket({ suffix: "DEBIT-FAILED" });
    const outbox = await createOutbox({ ticketId: ticket.id, suffix: "DEBIT-FAILED", type: "WALLET_DEBIT" });
    const { worker } = workerWith({ [outbox.operation_ref]: { status: "FAILED", retryable: false, message: "declined" } });

    await worker.processPendingOutboxRows();
    const updatedTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    const updatedOutbox = await prisma.walletOutbox.findUniqueOrThrow({ where: { id: outbox.id } });

    expect(updatedOutbox.status).toBe("FAILED");
    expect(updatedTicket.funding_status).toBe("FAILED");
    expect(isTicketEligibleForSettlement(updatedTicket)).toBe(false);
    await expect(auditCount("WALLET_DEBIT_FAILED", outbox.id)).resolves.toBe(1);
  });

  it("pending WALLET_DEBIT unknown keeps ticket ineligible", async () => {
    const ticket = await createWalletTicket({ suffix: "DEBIT-UNKNOWN" });
    const outbox = await createOutbox({ ticketId: ticket.id, suffix: "DEBIT-UNKNOWN", type: "WALLET_DEBIT" });
    const { worker } = workerWith({ [outbox.operation_ref]: { status: "UNKNOWN", message: "timeout after wallet accept" } });

    await worker.processPendingOutboxRows();
    const updatedTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    const updatedOutbox = await prisma.walletOutbox.findUniqueOrThrow({ where: { id: outbox.id } });

    expect(updatedOutbox.status).toBe("UNKNOWN");
    expect(updatedTicket.funding_status).toBe("UNKNOWN");
    expect(isTicketEligibleForSettlement(updatedTicket)).toBe(false);
    await expect(auditCount("WALLET_DEBIT_UNKNOWN", outbox.id)).resolves.toBe(1);
  });

  it("pending WALLET_CREDIT succeeds and updates payout_status", async () => {
    const ticket = await createWalletTicket({ suffix: "CREDIT-SUCCESS", funding_status: "SUCCEEDED", ticket_status: "SETTLED", payout_status: "PENDING" });
    const outbox = await createOutbox({ ticketId: ticket.id, suffix: "CREDIT-SUCCESS", type: "WALLET_CREDIT", amount: 90 });
    const { worker } = workerWith({});

    await worker.processPendingOutboxRows();
    const updatedTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    const updatedOutbox = await prisma.walletOutbox.findUniqueOrThrow({ where: { id: outbox.id } });

    expect(updatedOutbox.status).toBe("SUCCEEDED");
    expect(updatedTicket.payout_status).toBe("SUCCEEDED");
    await expect(auditCount("WALLET_CREDIT_SUCCEEDED", outbox.id)).resolves.toBe(1);
  });

  it("already succeeded outbox is skipped", async () => {
    const ticket = await createWalletTicket({ suffix: "SKIP-SUCCEEDED" });
    const outbox = await createOutbox({ ticketId: ticket.id, suffix: "SKIP-SUCCEEDED", type: "WALLET_DEBIT", status: "SUCCEEDED" });
    const { worker, client } = workerWith({});

    const report = await worker.processPendingOutboxRows();
    const updatedOutbox = await prisma.walletOutbox.findUniqueOrThrow({ where: { id: outbox.id } });

    expect(report).toMatchObject({ processed: 0, skipped: 0 });
    expect(client.callCount(outbox.operation_ref)).toBe(0);
    expect(updatedOutbox.status).toBe("SUCCEEDED");
  });

  it("retryable failure increments retry_count and next_retry_at", async () => {
    const ticket = await createWalletTicket({ suffix: "RETRYABLE" });
    const outbox = await createOutbox({ ticketId: ticket.id, suffix: "RETRYABLE", type: "WALLET_DEBIT" });
    const { worker } = workerWith({ [outbox.operation_ref]: { status: "FAILED", retryable: true, message: "temporary unavailable" } });

    const report = await worker.processPendingOutboxRows();
    const updatedOutbox = await prisma.walletOutbox.findUniqueOrThrow({ where: { id: outbox.id } });
    const updatedTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });

    expect(report).toMatchObject({ processed: 1, retries_scheduled: 1 });
    expect(updatedOutbox.status).toBe("PENDING");
    expect(updatedOutbox.retry_count).toBe(1);
    expect(updatedOutbox.next_retry_at?.toISOString()).toBe("2026-05-14T00:00:01.000Z");
    expect(updatedTicket.funding_status).toBe("PENDING");
    await expect(auditCount("WALLET_RETRY_SCHEDULED", outbox.id)).resolves.toBe(1);
  });

  it("non-retryable failure does not loop forever", async () => {
    const ticket = await createWalletTicket({ suffix: "NONRETRYABLE" });
    const outbox = await createOutbox({ ticketId: ticket.id, suffix: "NONRETRYABLE", type: "WALLET_DEBIT" });
    const { worker, client } = workerWith({ [outbox.operation_ref]: { status: "FAILED", retryable: false, message: "invalid account" } });

    const first = await worker.processPendingOutboxRows();
    const second = await worker.processPendingOutboxRows();
    const updatedOutbox = await prisma.walletOutbox.findUniqueOrThrow({ where: { id: outbox.id } });

    expect(first).toMatchObject({ processed: 1, failed: 1 });
    expect(second).toMatchObject({ processed: 0 });
    expect(client.callCount(outbox.operation_ref)).toBe(1);
    expect(updatedOutbox.status).toBe("FAILED");
    expect(updatedOutbox.next_retry_at).toBeNull();
  });

  it("processing is idempotent by operation_ref", async () => {
    const ticket = await createWalletTicket({ suffix: "IDEMPOTENT" });
    const outbox = await createOutbox({ ticketId: ticket.id, suffix: "IDEMPOTENT", type: "WALLET_DEBIT" });
    const { worker, client } = workerWith({});

    await worker.processPendingOutboxRows();
    await worker.processPendingOutboxRows();

    expect(client.callCount(outbox.operation_ref)).toBe(1);
    await expect(prisma.walletOutbox.count({ where: { operation_ref: outbox.operation_ref } })).resolves.toBe(1);
    await expect(prisma.walletOutbox.findUniqueOrThrow({ where: { id: outbox.id } }).then((row) => row.status)).resolves.toBe("SUCCEEDED");
  });

  it("reconciliation of UNKNOWN can mark final success or failure using mock result", async () => {
    const debitTicket = await createWalletTicket({ suffix: "RECON-DEBIT" });
    const creditTicket = await createWalletTicket({ suffix: "RECON-CREDIT", funding_status: "SUCCEEDED", ticket_status: "SETTLED", payout_status: "UNKNOWN" });
    const debitOutbox = await createOutbox({ ticketId: debitTicket.id, suffix: "RECON-DEBIT", type: "WALLET_DEBIT", status: "UNKNOWN" });
    const creditOutbox = await createOutbox({ ticketId: creditTicket.id, suffix: "RECON-CREDIT", type: "WALLET_CREDIT", status: "UNKNOWN" });
    const client = new ScriptedMockWalletClient();
    client.setReconciliationResult(debitOutbox.operation_ref, { status: "SUCCEEDED" });
    client.setReconciliationResult(creditOutbox.operation_ref, { status: "FAILED", message: "wallet reversal required" });
    const worker = new WalletOutboxWorkerService(prisma, client, { now: () => baseDate });

    const report = await worker.reconcileUnknownOutboxRows();
    const updatedDebitTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: debitTicket.id } });
    const updatedCreditTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: creditTicket.id } });

    expect(report).toMatchObject({ processed: 2, succeeded: 1, failed: 1 });
    expect(client.callCount(debitOutbox.operation_ref)).toBe(1);
    expect(client.callCount(creditOutbox.operation_ref)).toBe(1);
    expect(updatedDebitTicket.funding_status).toBe("SUCCEEDED");
    expect(updatedCreditTicket.payout_status).toBe("FAILED");
    await expect(auditCount("WALLET_DEBIT_SUCCEEDED", debitOutbox.id)).resolves.toBe(1);
    await expect(auditCount("WALLET_CREDIT_FAILED", creditOutbox.id)).resolves.toBe(1);
  });
});
