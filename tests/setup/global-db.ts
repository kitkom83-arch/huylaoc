import { spawnSync } from "node:child_process";

export default function setup(): void {
  process.env.DATABASE_URL ??= "postgresql://lottery:lottery@localhost:55432/lottery";

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
