import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Node environment, not jsdom: everything under test here is pure logic
// (series shaping, thresholds, formatting). Component rendering would need
// a DOM and @testing-library, which is a heavier commitment than the
// payoff — these functions are where the real edge cases live and where
// bugs have actually been found.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
