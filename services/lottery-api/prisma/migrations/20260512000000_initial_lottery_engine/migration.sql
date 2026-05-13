CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE game_mode AS ENUM ('EXTERNAL_WALLET', 'MANUAL_CREDIT');
CREATE TYPE round_status AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'RESULT_POSTED', 'CANCELLED');
CREATE TYPE quote_status AS ENUM ('CREATED', 'EXPIRED', 'CONFIRMED');
CREATE TYPE ticket_status AS ENUM ('PENDING_FUNDING', 'CONFIRMED', 'REJECTED', 'SETTLED', 'CANCELLED');
CREATE TYPE funding_status AS ENUM ('NOT_REQUIRED', 'PENDING', 'DEBITED', 'FAILED', 'UNKNOWN', 'REVERSED');
CREATE TYPE payout_status AS ENUM ('NOT_SETTLED', 'NO_WIN', 'PENDING', 'PAID', 'FAILED', 'UNKNOWN');
CREATE TYPE ledger_type AS ENUM ('TOPUP', 'DEDUCT', 'BET_DEBIT', 'BET_PAYOUT', 'ADJUSTMENT', 'REVERSAL');

CREATE TABLE bet_type_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  digits INTEGER NOT NULL CHECK (digits BETWEEN 1 AND 6),
  outcome_rule TEXT NOT NULL,
  default_odds NUMERIC(14, 4) NOT NULL CHECK (default_odds > 0),
  min_stake NUMERIC(14, 2) NOT NULL CHECK (min_stake > 0),
  max_stake NUMERIC(14, 2) NOT NULL CHECK (max_stake >= min_stake),
  enabled BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_code TEXT NOT NULL UNIQUE,
  game_code TEXT NOT NULL DEFAULT 'LOTTERY_6D',
  status round_status NOT NULL DEFAULT 'DRAFT',
  opens_at TIMESTAMPTZ NOT NULL,
  closes_at TIMESTAMPTZ NOT NULL,
  draws_at TIMESTAMPTZ NOT NULL,
  result_6d TEXT,
  paytable_snapshot JSONB NOT NULL,
  resulted_at TIMESTAMPTZ,
  created_by_admin_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT rounds_time_order CHECK (opens_at < closes_at AND closes_at <= draws_at),
  CONSTRAINT rounds_result_6d_format CHECK (result_6d IS NULL OR result_6d ~ '^[0-9]{6}$')
);

CREATE TABLE users_manual (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ENABLED' CHECK (status IN ('ENABLED', 'DISABLED')),
  created_by_admin_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE credit_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manual_user_id UUID NOT NULL UNIQUE REFERENCES users_manual(id),
  currency CHAR(3) NOT NULL DEFAULT 'THB',
  balance NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_no TEXT NOT NULL UNIQUE,
  round_id UUID NOT NULL REFERENCES rounds(id),
  mode game_mode NOT NULL,
  customer_ref TEXT,
  manual_user_id UUID REFERENCES users_manual(id),
  wallet_account_ref TEXT,
  external_txn_ref TEXT,
  stake_total NUMERIC(14, 2) NOT NULL CHECK (stake_total > 0),
  potential_payout_total NUMERIC(14, 2) NOT NULL CHECK (potential_payout_total >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'THB',
  status quote_status NOT NULL DEFAULT 'CREATED',
  expires_at TIMESTAMPTZ NOT NULL,
  request_hash TEXT NOT NULL,
  quote_snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_no TEXT NOT NULL UNIQUE,
  round_id UUID NOT NULL REFERENCES rounds(id),
  quote_id UUID NOT NULL UNIQUE REFERENCES quotes(id),
  mode game_mode NOT NULL,
  customer_ref TEXT,
  manual_user_id UUID REFERENCES users_manual(id),
  wallet_account_ref TEXT,
  external_txn_ref TEXT,
  stake_total NUMERIC(14, 2) NOT NULL CHECK (stake_total > 0),
  potential_payout_total NUMERIC(14, 2) NOT NULL CHECK (potential_payout_total >= 0),
  actual_payout_total NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (actual_payout_total >= 0),
  funding_status funding_status NOT NULL,
  payout_status payout_status NOT NULL DEFAULT 'NOT_SETTLED',
  status ticket_status NOT NULL,
  idempotency_scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  public_check_token_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ticket_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id),
  bet_type_code TEXT NOT NULL,
  number TEXT NOT NULL CHECK (number ~ '^[0-9]{1,6}$'),
  stake NUMERIC(14, 2) NOT NULL CHECK (stake > 0),
  odds_value NUMERIC(14, 4) NOT NULL CHECK (odds_value > 0),
  rule_snapshot JSONB NOT NULL,
  win_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (win_status IN ('PENDING', 'WIN', 'LOSE')),
  payout_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (payout_amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES rounds(id),
  result_6d TEXT NOT NULL CHECK (result_6d ~ '^[0-9]{6}$'),
  result_json JSONB NOT NULL,
  posted_by_admin_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE settlement_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES rounds(id),
  status TEXT NOT NULL DEFAULT 'PENDING',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE wallet_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('WALLET_DEBIT', 'WALLET_CREDIT', 'WALLET_REVERSAL')),
  status TEXT NOT NULL DEFAULT 'PENDING',
  ticket_id UUID REFERENCES tickets(id),
  external_txn_ref TEXT,
  wallet_account_ref TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_account_id UUID NOT NULL REFERENCES credit_accounts(id),
  manual_user_id UUID NOT NULL REFERENCES users_manual(id),
  type ledger_type NOT NULL,
  amount_delta NUMERIC(14, 2) NOT NULL,
  balance_before NUMERIC(14, 2) NOT NULL CHECK (balance_before >= 0),
  balance_after NUMERIC(14, 2) NOT NULL CHECK (balance_after >= 0),
  reason TEXT NOT NULL,
  admin_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  before JSONB,
  after JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL,
  actor_ref TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scope, actor_ref, idempotency_key)
);
