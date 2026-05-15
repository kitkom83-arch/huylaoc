import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

export default function setup(): void {
  process.env.DATABASE_URL = resolveDatabaseUrl();

  for (const action of ["migrate", "seed"]) {
    const result = spawnSync(process.execPath, ["scripts/db.mjs", action], {
      cwd: process.cwd(),
      stdio: "inherit",
      env: { ...process.env }
    });
    if (result.status !== 0) {
      throw new Error(`db:${action} failed. Start the test database with: docker compose -p lottery-engine up -d postgres redis`);
    }
  }
}

function resolveDatabaseUrl(): string {
  return (
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    readDatabaseUrlFromEnvFile() ??
    "postgresql://lottery:lottery@localhost:55432/lottery"
  );
}

function readDatabaseUrlFromEnvFile(): string | undefined {
  for (const filePath of [".env.test", ".env"]) {
    if (!existsSync(filePath)) {
      continue;
    }

    const values = readEnvFile(filePath);
    const databaseUrl = values.TEST_DATABASE_URL ?? values.DATABASE_URL;
    if (databaseUrl) {
      return databaseUrl;
    }
  }

  return undefined;
}

function readEnvFile(filePath: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    values[key] = unquote(rawValue.trim());
  }

  return values;
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
