ALTER TABLE wallet_outbox ADD COLUMN IF NOT EXISTS operation_ref TEXT;
UPDATE wallet_outbox SET operation_ref = id::text WHERE operation_ref IS NULL;
ALTER TABLE wallet_outbox ALTER COLUMN operation_ref SET DEFAULT gen_random_uuid()::text;
ALTER TABLE wallet_outbox ALTER COLUMN operation_ref SET NOT NULL;

ALTER TABLE wallet_outbox ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE wallet_outbox ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;
ALTER TABLE wallet_outbox ADD COLUMN IF NOT EXISTS last_error TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS wallet_outbox_operation_ref_key ON wallet_outbox(operation_ref);
CREATE INDEX IF NOT EXISTS wallet_outbox_status_next_retry_at_idx ON wallet_outbox(status, next_retry_at);
