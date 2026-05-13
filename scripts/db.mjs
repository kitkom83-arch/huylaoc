import { readdirSync, readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const defaultDatabaseUrl = "postgresql://lottery:lottery@localhost:55432/lottery";
const action = process.argv[2];

if (!action || !["migrate", "seed", "reset"].includes(action)) {
  console.error("Usage: node scripts/db.mjs <migrate|seed|reset>");
  process.exit(1);
}

process.env.DATABASE_URL ??= defaultDatabaseUrl;

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});

try {
  if (action === "migrate") {
    await migrate();
  }
  if (action === "seed") {
    await executeSqlFile("db/seed/seed-bet-types.sql");
    console.log("Seed applied");
  }
  if (action === "reset") {
    await prisma.$executeRawUnsafe("DROP SCHEMA IF EXISTS public CASCADE");
    await prisma.$executeRawUnsafe("CREATE SCHEMA public");
    await migrate();
    await executeSqlFile("db/seed/seed-bet-types.sql");
    console.log("Database reset");
  }
} finally {
  await prisma.$disconnect();
}

async function migrate() {
  await ensureMigrationTable();
  const migrations = readdirSync("services/lottery-api/prisma/migrations", { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  let applied = 0;
  for (const migrationName of migrations) {
    const existing = await prisma.$queryRaw`
      SELECT 1 FROM "_prisma_migrations" WHERE migration_name = ${migrationName}
    `;
    if (existing.length > 0) {
      continue;
    }

    const sql = readFileSync(`services/lottery-api/prisma/migrations/${migrationName}/migration.sql`, "utf8");
    await executeStatements(sql);
    await prisma.$executeRaw`
      INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
      VALUES (${randomUUID()}, ${sha256(sql)}, now(), ${migrationName}, NULL, NULL, now(), 1)
    `;
    applied += 1;
    console.log(`Migration applied: ${migrationName}`);
  }

  if (applied === 0) {
    console.log("Migration already applied");
  }
}

async function ensureMigrationTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      id VARCHAR(36) PRIMARY KEY NOT NULL,
      checksum VARCHAR(64) NOT NULL,
      finished_at TIMESTAMPTZ,
      migration_name VARCHAR(255) NOT NULL,
      logs TEXT,
      rolled_back_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      applied_steps_count INTEGER NOT NULL DEFAULT 0
    )
  `);
}

async function executeSqlFile(file) {
  await executeStatements(readFileSync(file, "utf8"));
}

async function executeStatements(sql) {
  for (const statement of splitStatements(sql)) {
    await prisma.$executeRawUnsafe(statement);
  }
}

function splitStatements(sql) {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
