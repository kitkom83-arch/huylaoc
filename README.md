# Lottery Game Engine

API-first lottery game engine with manual backoffice support.

This project intentionally excludes deposits, withdrawals, main wallet custody, real payment gateways, real-money transfers, casino provider integrations, and P1 bet types.

## Commands

```bash
pnpm install --frozen-lockfile
docker compose -p lottery-engine up -d postgres redis
pnpm db:migrate
pnpm db:seed
pnpm build
pnpm check
pnpm test
pnpm dev:api
```

`DATABASE_URL` defaults to the local docker-compose PostgreSQL URL on port `55432` for repo scripts. Override it when targeting another database.

## Phase 1 Scope

- P0 straight bet rules only: ONE_DIGIT through SIX_STRAIGHT.
- Manual credit ledger basics.
- Idempotency for side-effect requests.
- PostgreSQL migration schema.
- Demo customer and backoffice static apps.
