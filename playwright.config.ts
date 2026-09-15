import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4329",
    viewport: { width: 1454, height: 876 },
    trace: "off",
  },
  webServer: {
    command: "pnpm exec tsx tests/host.ts",
    url: "http://127.0.0.1:4329/healthz",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
