ALTER TYPE payout_status ADD VALUE IF NOT EXISTS 'SUCCEEDED';
ALTER TYPE ledger_type ADD VALUE IF NOT EXISTS 'PAYOUT_CREDIT';

ALTER TABLE tickets
  DROP CONSTRAINT IF EXISTS tickets_settlement_status_check;

ALTER TABLE tickets
  ADD CONSTRAINT tickets_settlement_status_check
  CHECK (settlement_status IN ('PENDING', 'WON', 'LOST', 'SETTLED', 'CANCELLED'));
