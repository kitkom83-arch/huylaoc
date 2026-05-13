import { PrismaClient, type Prisma, type WalletOutbox } from "@prisma/client";

export type WalletOutboxStatus = "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "UNKNOWN";

export interface WalletOutboxTransitionResult {
  outbox_id: string;
  previous_status: WalletOutboxStatus;
  status: WalletOutboxStatus;
  changed: boolean;
}

const terminalStatuses = new Set<WalletOutboxStatus>(["SUCCEEDED", "FAILED", "UNKNOWN"]);

type DbClient = PrismaClient | Prisma.TransactionClient;

function assertAllowedTransition(current: WalletOutboxStatus, next: WalletOutboxStatus): void {
  if (current === next) {
    return;
  }
  if (terminalStatuses.has(current)) {
    throw new Error(`wallet outbox ${current} cannot transition to ${next}`);
  }
}

async function appendAudit(db: DbClient, outbox: WalletOutbox, previousStatus: WalletOutboxStatus, nextStatus: WalletOutboxStatus): Promise<void> {
  await db.auditLog.create({
    data: {
      actor_type: "SYSTEM",
      actor_id: "wallet-outbox-worker",
      action: "WALLET_OUTBOX_STATUS_CHANGE",
      resource_type: "wallet_outbox",
      resource_id: outbox.id,
      before: { status: previousStatus, ticket_id: outbox.ticket_id, type: outbox.type },
      after: { status: nextStatus, ticket_id: outbox.ticket_id, type: outbox.type }
    }
  });
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
      const rows = await tx.$queryRaw<Array<WalletOutbox>>`
        SELECT * FROM wallet_outbox WHERE id = CAST(${outboxId} AS uuid) FOR UPDATE
      `;
      const outbox = rows[0];
      if (!outbox) {
        throw new Error("wallet outbox not found");
      }

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

      await tx.walletOutbox.update({ where: { id: outbox.id }, data: { status: nextStatus } });
      await this.updateRelatedTicket(tx, outbox, nextStatus);
      await appendAudit(tx, outbox, previousStatus, nextStatus);

      return {
        outbox_id: outbox.id,
        previous_status: previousStatus,
        status: nextStatus,
        changed: true
      };
    });
  }

  private async updateRelatedTicket(db: Prisma.TransactionClient, outbox: WalletOutbox, nextStatus: WalletOutboxStatus): Promise<void> {
    if (outbox.type !== "WALLET_DEBIT" || !outbox.ticket_id || nextStatus === "PROCESSING") {
      return;
    }

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
  }
}

export function describeWalletOutboxWorker(): string {
  return "wallet-outbox-worker skeleton: state transitions only; no external wallet calls are implemented";
}

const executedPath = process.argv[1] ?? "";

if (executedPath.endsWith("services/wallet-outbox-worker/src/main.ts") || executedPath.endsWith("services\\wallet-outbox-worker\\src\\main.ts") || executedPath.endsWith("services/wallet-outbox-worker/dist/main.js") || executedPath.endsWith("services\\wallet-outbox-worker\\dist\\main.js")) {
  console.log(describeWalletOutboxWorker());
}
