import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Live smoke checks against the real Qloo hackathon API. Run with `npm run smoke:live` once QLOO_API_KEY is set.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/live/**/*.live.ts"],
    testTimeout: 30_000,
    reporters: ["verbose"],
  },
});
