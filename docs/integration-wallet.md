# External Wallet Integration

External wallet mode does not hold customer main balances.

The lottery engine stores:

- `customer_ref`
- `wallet_account_ref`
- `external_txn_ref`
- `funding_status`
- `payout_status`

P0 only creates the `wallet_outbox` schema and worker skeleton. Live debit, credit, reversal, and reconciliation calls are intentionally not implemented.
