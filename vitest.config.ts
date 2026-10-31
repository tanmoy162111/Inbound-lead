import { defineConfig } from "vitest/config";

try {
  process.loadEnvFile(".env");
} catch {
  // .env is optional (CI provides env vars directly)
}

export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], fileParallelism: false },
});
