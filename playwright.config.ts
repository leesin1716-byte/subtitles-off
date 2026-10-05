import { defineConfig } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3917);

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  workers: 1,
  reporter: "list",
  use: { baseURL: `http://localhost:${port}`, viewport: { width: 1280, height: 900 } },
  webServer: {
    command: `npx next start -p ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { QLOO_MODE: "mock", LLM_MODE: "off" },
  },
});
