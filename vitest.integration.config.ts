import { defineConfig } from "vitest/config";
import base from "./vitest.config";

// Integration-only config used for scoped coverage and mutation testing
// (see stryker.config.json). Coverage is limited to the code the integration
// tests actually target, so the thresholds are meaningful.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    projects: base.test?.projects?.filter(
      (p) =>
        typeof p === "object" &&
        "test" in p &&
        p.test?.name === "server-integration"
    ),
    coverage: {
      ...base.test?.coverage,
      include: [
        "server/routes/api/{documents,collections,shares}/*.ts",
        "server/policies/{document,collection,share}.ts",
        "server/commands/document{Creator,Updater,Mover,Restorer}.ts",
      ],
      exclude: ["**/*.test.ts", "**/schema.ts", "**/index.ts"],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage/integration",
      // Floors just below measured values; raise them as tests are added.
      thresholds: {
        lines: 60,
        branches: 58,
        "server/policies/**": { lines: 95, branches: 92 },
        "server/commands/**": { lines: 80, branches: 72 },
        "server/routes/**": { lines: 50, branches: 45 },
      },
    },
  },
});
