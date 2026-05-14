import { PrismaClient, type Prisma, type WalletOutbox } from "@prisma/client";

export type WalletOutboxStatus = "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "UNKNOWN";
export type WalletOutboxType = "WALLET_DEBIT" | "WALLET_CREDIT";
export type MockWalletFinalStatus = "SUCCEEDED" | "FAILED" | "UNKNOWN";

export interface WalletOutboxTransitionResult {
  outbox_id: string;
  previous_status: WalletOutboxStatus;
  status: WalletOutboxStatus;
  changed: boolean;
}

export interface WalletOperation {
  type: WalletOutboxType;
  operation_ref: string;
  outbox_id: string;
  ticket_id?: string;
  wallet_account_ref?: string;
  external_txn_ref?: string;
  amount?: number;
  currency_code?: string;
  payload: Prisma.JsonValue;
}

export interface MockWalletResult {
  status: MockWalletFinalStatus;
  retryable?: boolean;
  message?: string;
}

export interface MockWalletClient {
  debit(operation: WalletOperation): Promise<MockWalletResult>;
  credit(operation: WalletOperation): Promise<MockWalletResult>;
  reconcile(operation: WalletOperation): Promise<MockWalletResult>;
}

export interface WalletOutboxWorkerOptions {
  batchSize?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  now?: () => Date;
}

export interface WalletOutboxWorkerReport {
  processed: number;
  succeeded: number;
  failed: number;
  unknown: number;
  retries_scheduled: number;
  skipped: number;
}

type DbClient = PrismaClient | Prisma.TransactionClient;

const terminalStatuses = new Set<WalletOutboxStatus>(["SUCCEEDED", "FAILED"]);
const workerActorId = "wallet-outbox-worker";

function defaultReport(): WalletOutboxWorkerReport {
  return {
    processed: 0,
    succeeded: 0,
    failed: 0,
    unknown: 0,
    retries_scheduled: 0,
    skipped: 0
  };
}

function assertAllowedTransition(current: WalletOutboxStatus, next: WalletOutboxStatus): void {
  if (current === next) {
    return;
  }
  if (terminalStatuses.has(current)) {
    throw new Error(`wallet outbox ${current} cannot transition to ${next}`);
  }
  if (current === "UNKNOWN" && next !== "SUCCEEDED" && next !== "FAILED") {
    throw new Error(`wallet outbox UNKNOWN cannot transition to ${next}`);
  }
}

function jsonObject(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberFromPayload(payload: Prisma.JsonValue, keys: string[]): number | undefined {
  const value = keys.map((key) => jsonObject(payload)[key]).find((entry) => typeof entry === "number" || typeof entry === "string");
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function stringFromPayload(payload: Prisma.JsonValue, key: string): string | undefined {
  const value = jsonObject(payload)[key];
  return typeof value === "string" ? value : undefined;
}

function operationFromOutbox(outbox: WalletOutbox): WalletOperation {
  const payload = outbox.payload as Prisma.JsonValue;
  return {
    type: outbox.type as WalletOutboxType,
    operation_ref: outbox.operation_ref,
    outbox_id: outbox.id,
    ticket_id: outbox.ticket_id ?? undefined,
    wallet_account_ref: outbox.wallet_account_ref ?? undefined,
    external_txn_ref: outbox.external_txn_ref ?? undefined,
    amount: numberFromPayload(payload, ["stake_total", "payout_total", "amount"]),
    currency_code: stringFromPayload(payload, "currency_code"),
    payload
  };
}

function backoffMs(retryCount: number, options: Required<Pick<WalletOutboxWorkerOptions, "baseBackoffMs" | "maxBackoffMs">>): number {
  return Math.min(options.baseBackoffMs * 2 ** Math.max(retryCount - 1, 0), options.maxBackoffMs);
}

function sanitizedError(message?: string): string | undefined {
  return message?.slice(0, 500);
}

async function appendAudit(
  db: DbClient,
  outbox: WalletOutbox,
  previousStatus: WalletOutboxStatus,
  nextStatus: WalletOutboxStatus,
  action = "WALLET_OUTBOX_STATUS_CHANGE",
  extra: Record<string, unknown> = {}
): Promise<void> {
  await db.auditLog.create({
    data: {
      actor_type: "SYSTEM",
      actor_id: workerActorId,
      action,
      resource_type: "wallet_outbox",
      resource_id: outbox.id,
      before: { status: previousStatus, ticket_id: outbox.ticket_id, type: outbox.type },
      after: {
        status: nextStatus,
        ticket_id: outbox.ticket_id,
        type: outbox.type,
        operation_ref: outbox.operation_ref,
        ...extra
      }
    }
  });
}

async function updateRelatedTicket(db: Prisma.TransactionClient, outbox: WalletOutbox, nextStatus: WalletOutboxStatus): Promise<void> {
  if (!outbox.ticket_id || nextStatus === "PROCESSING" || nextStatus === "PENDING") {
    return;
  }

  if (outbox.type === "WALLET_DEBIT") {
    if (nextStatus === "SUCCEEDED") {
      await db.ticket.update({
        where: { id: outbox.ticket_id },
        data: { funding_status: "SUCCEEDED", status: "CONFIRMED" }
      });
      return;
    }

    await db.ticket.update({
      where: { id: outbox.ticket_id },
      data: {
        funding_status: nextStatus,
        ...(nextStatus === "FAILED" ? { status: "REJECTED" as const } : {})
      }
    });
    return;
  }

  if (outbox.type === "WALLET_CREDIT") {
    await db.ticket.update({
      where: { id: outbox.ticket_id },
      data: { payout_status: nextStatus as "SUCCEEDED" | "FAILED" | "UNKNOWN" }
    });
  }
}

async function applyFinalStatus(
  db: Prisma.TransactionClient,
  outbox: WalletOutbox,
  nextStatus: Extract<WalletOutboxStatus, "SUCCEEDED" | "FAILED" | "UNKNOWN">,
  action: string,
  message?: string
): Promise<void> {
  const previousStatus = outbox.status as WalletOutboxStatus;
  assertAllowedTransition(previousStatus, nextStatus);
  if (previousStatus === nextStatus) {
    return;
  }

  await db.walletOutbox.update({
    where: { id: outbox.id },
    data: {
      status: nextStatus,
      next_retry_at: null,
      last_error: nextStatus === "SUCCEEDED" ? null : sanitizedError(message)
    }
  });
  await updateRelatedTicket(db, outbox, nextStatus);
  await appendAudit(db, outbox, previousStatus, nextStatus, action, message ? { message: sanitizedError(message) } : {});
}

async function lockOutbox(db: DbClient, outboxId: string): Promise<WalletOutbox> {
  const rows = await db.$queryRaw<Array<WalletOutbox>>`
    SELECT * FROM wallet_outbox WHERE id = CAST(${outboxId} AS uuid) FOR UPDATE
  `;
  const outbox = rows[0];
  if (!outbox) {
    throw new Error("wallet outbox not found");
  }
  return outbox;
}

export class ScriptedMockWalletClient implements MockWalletClient {
  readonly calls: WalletOperation[] = [];
  private readonly operationResults = new Map<string, MockWalletResult>();
  private readonly reconciliationResults = new Map<string, MockWalletResult>();

  constructor(private readonly defaultResult: MockWalletResult = { status: "SUCCEEDED" }) {}

  setOperationResult(operationRef: string, result: MockWalletResult): void {
    this.operationResults.set(operationRef, result);
  }

  setReconciliationResult(operationRef: string, result: MockWalletResult): void {
    this.reconciliationResults.set(operationRef, result);
  }

  debit(operation: WalletOperation): Promise<MockWalletResult> {
    this.calls.push(operation);
    return Promise.resolve(this.operationResults.get(operation.operation_ref) ?? this.defaultResult);
  }

  credit(operation: WalletOperation): Promise<MockWalletResult> {
    this.calls.push(operation);
    return Promise.resolve(this.operationResults.get(operation.operation_ref) ?? this.defaultResult);
  }

  reconcile(operation: WalletOperation): Promise<MockWalletResult> {
    this.calls.push(operation);
    return Promise.resolve(this.reconciliationResults.get(operation.operation_ref) ?? { status: "UNKNOWN" });
  }

  callCount(operationRef: string): number {
    return this.calls.filter((call) => call.operation_ref === operationRef).length;
  }
}

export class WalletOutboxStateService {
  constructor(private readonly prisma: PrismaClient = new PrismaClient()) {}

  markWalletOutboxProcessing(outboxId: string): Promise<WalletOutboxTransitionResult> {
    return this.transition(outboxId, "PROCESSING");
  }

  markWalletOutboxSucceeded(outboxId: string): Promise<WalletOutboxTransitionResult> {
    return this.transition(outboxId, "SUCCEEDED");
  }

  markWalletOutboxFailed(outboxId: string): Promise<WalletOutboxTransitionResult> {
    return this.transition(outboxId, "FAILED");
  }

  markWalletOutboxUnknown(outboxId: string): Promise<WalletOutboxTransitionResult> {
    return this.transition(outboxId, "UNKNOWN");
  }

  private async transition(outboxId: string, nextStatus: WalletOutboxStatus): Promise<WalletOutboxTransitionResult> {
    return this.prisma.$transaction(async (tx) => {
      const outbox = await lockOutbox(tx, outboxId);
      const previousStatus = outbox.status as WalletOutboxStatus;
      assertAllowedTransition(previousStatus, nextStatus);
      if (previousStatus === nextStatus) {
        return {
          outbox_id: outbox.id,
          previous_status: previousStatus,
          status: nextStatus,
          changed: false
        };
      }

      await tx.walletOutbox.update({ where: { id: outbox.id }, data: { status: nextStatus, next_retry_at: null } });
      await updateRelatedTicket(tx, outbox, nextStatus);
      await appendAudit(tx, outbox, previousStatus, nextStatus);

      return {
        outbox_id: outbox.id,
        previous_status: previousStatus,
        status: nextStatus,
        changed: true
      };
    });
  }
}

export class WalletOutboxWorkerService {
  private readonly options: Required<WalletOutboxWorkerOptions>;

  constructor(
    private readonly prisma: PrismaClient = new PrismaClient(),
    private readonly walletClient: MockWalletClient = new ScriptedMockWalletClient(),
    options: WalletOutboxWorkerOptions = {}
  ) {
    this.options = {
      batchSize: options.batchSize ?? 25,
      maxRetries: options.maxRetries ?? 3,
      baseBackoffMs: options.baseBackoffMs ?? 30_000,
      maxBackoffMs: options.maxBackoffMs ?? 5 * 60_000,
      now: options.now ?? (() => new Date())
    };
  }

  disconnect(): Promise<void> {
    return this.prisma.$disconnect();
  }

  async processPendingOutboxRows(limit = this.options.batchSize): Promise<WalletOutboxWorkerReport> {
    const report = defaultReport();
    const rows = await this.claimDuePendingRows(limit);

    for (const outbox of rows) {
      const result = await this.processClaimedRow(outbox);
      report.processed += 1;
      report.succeeded += result === "SUCCEEDED" ? 1 : 0;
      report.failed += result === "FAILED" ? 1 : 0;
      report.unknown += result === "UNKNOWN" ? 1 : 0;
      report.retries_scheduled += result === "PENDING" ? 1 : 0;
    }

    return report;
  }

  async reconcileUnknownOutboxRows(limit = this.options.batchSize): Promise<WalletOutboxWorkerReport> {
    const report = defaultReport();
    const rows = await this.lockUnknownRows(limit);

    for (const outbox of rows) {
      const result = await this.walletClient.reconcile(operationFromOutbox(outbox));
      if (result.status === "UNKNOWN") {
        report.unknown += 1;
        continue;
      }

      await this.prisma.$transaction(async (tx) => {
        const locked = await lockOutbox(tx, outbox.id);
        if (locked.status !== "UNKNOWN") {
          report.skipped += 1;
          return;
        }
        await applyFinalStatus(tx, locked, result.status, auditAction(locked.type as WalletOutboxType, result.status), result.message);
        report.processed += 1;
        report.succeeded += result.status === "SUCCEEDED" ? 1 : 0;
        report.failed += result.status === "FAILED" ? 1 : 0;
      });
    }

    return report;
  }

  private async claimDuePendingRows(limit: number): Promise<WalletOutbox[]> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<WalletOutbox>>`
        SELECT *
        FROM wallet_outbox
        WHERE type IN ('WALLET_DEBIT', 'WALLET_CREDIT')
          AND status = 'PENDING'
          AND (next_retry_at IS NULL OR next_retry_at <= ${this.options.now()})
        ORDER BY created_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `;

      for (const row of rows) {
        await tx.walletOutbox.update({
          where: { id: row.id },
          data: { status: "PROCESSING" }
        });
      }

      return rows.map((row) => ({ ...row, status: "PROCESSING" }));
    });
  }

  private async lockUnknownRows(limit: number): Promise<WalletOutbox[]> {
    return this.prisma.$transaction(async (tx) => {
      return tx.$queryRaw<Array<WalletOutbox>>`
        SELECT *
        FROM wallet_outbox
        WHERE type IN ('WALLET_DEBIT', 'WALLET_CREDIT')
          AND status = 'UNKNOWN'
        ORDER BY updated_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `;
    });
  }

  private async processClaimedRow(outbox: WalletOutbox): Promise<WalletOutboxStatus> {
    let result: MockWalletResult;
    try {
      const operation = operationFromOutbox(outbox);
      result = outbox.type === "WALLET_DEBIT"
        ? await this.walletClient.debit(operation)
        : await this.walletClient.credit(operation);
    } catch (error) {
      result = { status: "FAILED", retryable: true, message: error instanceof Error ? error.message : "mock wallet failure" };
    }

    return this.prisma.$transaction(async (tx) => {
      const locked = await lockOutbox(tx, outbox.id);
      if (locked.status === "SUCCEEDED" || locked.status === "FAILED") {
        return locked.status as WalletOutboxStatus;
      }
      if (locked.status !== "PROCESSING") {
        return locked.status as WalletOutboxStatus;
      }

      if (result.status === "FAILED" && result.retryable) {
        return this.scheduleRetryOrFail(tx, locked, result.message);
      }

      await applyFinalStatus(tx, locked, result.status, auditAction(locked.type as WalletOutboxType, result.status), result.message);
      return result.status;
    });
  }

  private async scheduleRetryOrFail(db: Prisma.TransactionClient, outbox: WalletOutbox, message?: string): Promise<WalletOutboxStatus> {
    const nextRetryCount = outbox.retry_count + 1;
    if (nextRetryCount >= this.options.maxRetries) {
      await db.walletOutbox.update({
        where: { id: outbox.id },
        data: {
          status: "FAILED",
          retry_count: nextRetryCount,
          next_retry_at: null,
          last_error: sanitizedError(message)
        }
      });
      await updateRelatedTicket(db, outbox, "FAILED");
      await appendAudit(db, outbox, outbox.status as WalletOutboxStatus, "FAILED", auditAction(outbox.type as WalletOutboxType, "FAILED"), {
        retry_count: nextRetryCount,
        max_retries: this.options.maxRetries,
        message: sanitizedError(message)
      });
      return "FAILED";
    }

    const nextRetryAt = new Date(this.options.now().getTime() + backoffMs(nextRetryCount, this.options));
    await db.walletOutbox.update({
      where: { id: outbox.id },
      data: {
        status: "PENDING",
        retry_count: nextRetryCount,
        next_retry_at: nextRetryAt,
        last_error: sanitizedError(message)
      }
    });
    await appendAudit(db, outbox, outbox.status as WalletOutboxStatus, "PENDING", "WALLET_RETRY_SCHEDULED", {
      retry_count: nextRetryCount,
      next_retry_at: nextRetryAt.toISOString(),
      message: sanitizedError(message)
    });
    return "PENDING";
  }
}

function auditAction(type: WalletOutboxType, status: MockWalletFinalStatus): string {
  const prefix = type === "WALLET_DEBIT" ? "WALLET_DEBIT" : "WALLET_CREDIT";
  return `${prefix}_${status}`;
}

export function describeWalletOutboxWorker(): string {
  return "wallet-outbox-worker: mock debit/credit processing, retry backoff, UNKNOWN reconciliation, and idempotent status handling";
}

const executedPath = process.argv[1] ?? "";

if (executedPath.endsWith("services/wallet-outbox-worker/src/main.ts") || executedPath.endsWith("services\\wallet-outbox-worker\\src\\main.ts") || executedPath.endsWith("services/wallet-outbox-worker/dist/main.js") || executedPath.endsWith("services\\wallet-outbox-worker\\dist\\main.js")) {
  const worker = new WalletOutboxWorkerService();
  try {
    const report = await worker.processPendingOutboxRows();
    console.log(JSON.stringify(report));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "wallet outbox worker failed");
    process.exitCode = 1;
  } finally {
    await worker.disconnect();
  }
}
