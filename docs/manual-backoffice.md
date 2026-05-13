# Manual Backoffice

Manual mode uses internal credit accounts only for standalone lottery testing and office-managed play.

Rules:

- Create a manual user before issuing credit.
- All topups, deductions, and bet debits must write `credit_ledger`.
- Manual credit balance is derived operationally through locked account updates plus immutable ledger rows.
- Admin and manual actions must write `audit_logs`.
- Ledger and audit logs are append-only at the application layer.
- P0 exposes only create manual user, topup, deduct, and ledger listing.
