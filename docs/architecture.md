# Architecture

This repository is a safe P0 foundation for an API-first lottery game engine.

Boundaries:

- `services/lottery-api` owns HTTP APIs, validation, idempotency, audit logging, manual credit, and Prisma configuration.
- `packages/domain` owns shared enums and DTO allowlists.
- `packages/rules` owns P0 straight outcome derivation and rule matching.
- `services/settlement-worker` and `services/wallet-outbox-worker` are compile-only skeletons for later queue processing.

The current API repository is intentionally small and testable. PostgreSQL persistence is represented by Prisma schema and SQL migration; wiring runtime repository methods to Prisma transactions is the next phase.
