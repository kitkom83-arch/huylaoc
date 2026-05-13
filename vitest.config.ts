import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "packages/**/*.test.ts", "services/**/*.test.ts"],
    environment: "node",
    testTimeout: 30000,
    pool: "forks",
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: 1,
        singleFork: true
      }
    },
    fileParallelism: false,
    globalSetup: ["tests/setup/global-db.ts"]
  },
  resolve: {
    alias: {
      "@lottery/domain": root("./packages/domain/src/index.ts"),
      "@lottery/rules": root("./packages/rules/src/index.ts"),
      "@lottery/lottery-api": root("./services/lottery-api/src/index.ts")
    }
  }
});
