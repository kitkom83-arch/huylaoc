import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import * as argon2 from "argon2";
import type { Prisma } from "@prisma/client";
import { AuditLogRepository } from "../audit/audit-log.repository.js";
import { CreditLedgerRepository } from "./credit-ledger.repository.js";
import { PrismaRepository } from "../store/prisma.repository.js";
import type { ManualUserRecord } from "../store/records.js";

type ManualUserStatus = "ACTIVE" | "SUSPENDED" | "CLOSED";
type StoredManualUserStatus = "ENABLED" | "DISABLED";

export type ManualUserStatusResponse = {
  user_manual_id: string;
  username: string;
  display_name: string;
  status: ManualUserStatus;
  updated_at: string;
};

@Injectable()
export class ManualCreditService {
  constructor(
    private readonly repo: PrismaRepository,
    private readonly ledger: CreditLedgerRepository,
    private readonly audit: AuditLogRepository
  ) {}

  async createUser(input: { username: string; display_name: string; password: string }, actorId: string, db: Prisma.TransactionClient) {
    const existing = await db.manualUser.findUnique({ where: { username: input.username } });
    if (existing) {
      throw new ConflictException("username already exists");
    }
    const created = await this.repo.createManualUserWithAccount(
      {
        username: input.username,
        display_name: input.display_name,
        password_hash: await argon2.hash(input.password, { type: argon2.argon2id })
      },
      actorId,
      db
    );
    await this.audit.append({ actor_type: "ADMIN", actor_id: actorId, action: "MANUAL_USER_CREATE", resource_type: "users_manual", resource_id: created.user.id, after: this.safeUser(created.user) }, db);
    return { user: this.safeUser(created.user), credit_account: created.credit_account };
  }

  topup(input: { manual_user_id: string; amount: number; reason: string }, actorId: string, db: Prisma.TransactionClient) {
    return this.applyLockedLedgerChange("TOPUP", input, actorId, db);
  }

  deduct(input: { manual_user_id: string; amount: number; reason: string }, actorId: string, db: Prisma.TransactionClient) {
    return this.applyLockedLedgerChange("DEDUCT", input, actorId, db);
  }

  listLedger() {
    return this.ledger.list();
  }

  updateUserStatus(input: { user_id: string; status: ManualUserStatus; reason_code?: string; note?: string }, actorId: string): Promise<ManualUserStatusResponse> {
    return this.repo.client().$transaction(async (tx) => {
      const user = await this.repo.getManualUser(input.user_id, tx);
      if (!user) {
        throw new NotFoundException("manual user not found");
      }

      const storedStatus = this.toStoredStatus(input.status);
      if (user.status === storedStatus) {
        return this.statusResponse(user, input.status);
      }

      const updated = await this.repo.updateManualUserStatus(input.user_id, storedStatus, tx);
      const after = {
        ...this.statusAuditSnapshot(updated, input.status),
        ...(input.reason_code ? { reason_code: input.reason_code } : {}),
        ...(input.note ? { note: input.note } : {})
      };
      await this.audit.append({
        actor_type: "ADMIN",
        actor_id: actorId,
        action: "MANUAL_USER_STATUS_UPDATE",
        resource_type: "users_manual",
        resource_id: updated.id,
        before: this.statusAuditSnapshot(user, this.toExternalStatus(user.status)),
        after
      }, tx);
      return this.statusResponse(updated, input.status);
    });
  }

  private async applyLockedLedgerChange(type: "TOPUP" | "DEDUCT", input: { manual_user_id: string; amount: number; reason: string }, actorId: string, db: Prisma.TransactionClient) {
    const account = await this.repo.lockCreditAccountByManualUserId(input.manual_user_id, db);
    const user = await this.repo.getManualUser(input.manual_user_id, db);
    if (!user || !account) {
      throw new NotFoundException("manual user or credit account not found");
    }
    if (user.status !== "ENABLED") {
      throw new ConflictException("manual user is disabled");
    }
    if (input.amount <= 0) {
      throw new BadRequestException("amount must be positive");
    }

    const delta = type === "TOPUP" ? input.amount : -input.amount;
    const balanceBefore = account.balance;
    const balanceAfter = Number((balanceBefore + delta).toFixed(2));
    if (balanceAfter < 0) {
      throw new ConflictException("insufficient credit");
    }
    const ledger = await this.ledger.append({
      credit_account_id: account.id,
      manual_user_id: user.id,
      type,
      amount_delta: delta,
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      reason: input.reason,
      admin_id: actorId
    }, db);
    const updatedAccount = await this.repo.updateCreditAccountBalance(account.id, balanceAfter, db);
    await this.audit.append({
      actor_type: "ADMIN",
      actor_id: actorId,
      action: type === "TOPUP" ? "MANUAL_CREDIT_TOPUP" : "MANUAL_CREDIT_DEDUCT",
      resource_type: "credit_accounts",
      resource_id: account.id,
      after: { ledger, credit_account: updatedAccount }
    }, db);
    return { ledger, credit_account: updatedAccount };
  }

  private safeUser(user: ManualUserRecord): Omit<ManualUserRecord, "password_hash"> {
    const { password_hash: _passwordHash, ...safe } = user;
    return safe;
  }

  private statusResponse(user: ManualUserRecord, status: ManualUserStatus = this.toExternalStatus(user.status)): ManualUserStatusResponse {
    return {
      user_manual_id: user.id,
      username: user.username,
      display_name: user.display_name,
      status,
      updated_at: user.updated_at
    };
  }

  private statusAuditSnapshot(user: ManualUserRecord, status: ManualUserStatus) {
    return {
      user_manual_id: user.id,
      username: user.username,
      display_name: user.display_name,
      status
    };
  }

  private toStoredStatus(status: ManualUserStatus): StoredManualUserStatus {
    return status === "ACTIVE" ? "ENABLED" : "DISABLED";
  }

  private toExternalStatus(status: StoredManualUserStatus): ManualUserStatus {
    return status === "ENABLED" ? "ACTIVE" : "SUSPENDED";
  }
}
