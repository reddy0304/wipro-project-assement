import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: false,
    // Tests don't hit the live LLM — they only exercise validation / matching
    // / anomaly logic. So no GEMINI_API_KEY is required at test time, and we
    // explicitly avoid loading src/config.ts in the tests we wrote.
  },
});
