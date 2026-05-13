import { PrismaClient } from "@prisma/client";

export const testDatabaseUrl = process.env.DATABASE_URL ?? "postgresql://lottery:lottery@localhost:55432/lottery";

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: testDatabaseUrl
    }
  }
});

export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      idempotency_keys,
      audit_logs,
      credit_ledger,
      settlement_jobs,
      results,
      ticket_items,
      tickets,
      wallet_outbox,
      quotes,
      credit_accounts,
      users_manual,
      rounds
    RESTART IDENTITY CASCADE
  `);
}

export async function closeDatabase(): Promise<void> {
  await prisma.$disconnect();
}
