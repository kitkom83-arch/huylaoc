import type { BetTypeCatalogEntry, LedgerType, RoundStatus } from "@lottery/domain";

export interface RoundRecord {
  id: string;
  round_code: string;
  status: RoundStatus;
  opens_at: string;
  closes_at: string;
  draws_at: string;
  result_6d: string | null;
  paytable_snapshot: BetTypeCatalogEntry[];
  created_at: string;
  updated_at: string;
}

export interface ResultRecord {
  id: string;
  round_id: string;
  result_6d: string;
  created_at: string;
}

export interface ManualUserRecord {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  status: "ENABLED" | "DISABLED";
  created_at: string;
}

export interface CreditAccountRecord {
  id: string;
  manual_user_id: string;
  currency: string;
  balance: number;
  version: number;
}

export interface CreditLedgerRecord {
  id: string;
  credit_account_id: string;
  manual_user_id: string;
  type: LedgerType;
  amount_delta: number;
  balance_before: number;
  balance_after: number;
  reason: string;
  admin_id: string;
  created_at: string;
}

export interface AuditLogRecord {
  id: string;
  actor_type: string;
  actor_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  before: unknown;
  after: unknown;
  created_at: string;
}

export interface IdempotencyRecord {
  scope: string;
  actor_ref: string;
  idempotency_key: string;
  request_hash: string;
  response_status: number | null;
  response_body: unknown;
}

export interface SettlementJobRecord {
  id: string;
  round_id: string;
  status: "PENDING";
  created_at: string;
}
