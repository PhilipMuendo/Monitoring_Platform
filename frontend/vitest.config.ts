import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Two projects, because the suite has two genuinely different shapes and
 * running pure-logic tests inside a DOM is pure overhead.
 *
 * `logic` — the original suite: series shaping, thresholds, formatting.
 *   Plain node, no DOM, fast.
 *
 * `components` — React rendering via jsdom and Testing Library. This did not
 *   exist before: every test in the repo covered a pure function, which meant
 *   the stateful, effect-driven code (the auth gate, the SSE reconnect, alert
 *   rendering) — exactly where the bugs live — had no coverage at all.
 *
 * JSX is handled by Vite's built-in oxc transform (automatic runtime is the
 * default for .tsx), so no babel plugin is needed — and @vitejs/plugin-react
 * conflicts with the babel version shadcn pins anyway.
 *
 * The components project runs on the threads pool: the default forks pool
 * spawns a child process per file, and on Windows the cost of booting jsdom
 * in a fresh process exceeded the worker start timeout.
 */
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "logic",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "components",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./src/test/setup.ts"],
          globals: true,
          pool: "threads",
          testTimeout: 15_000,
        },
      },
    ],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
