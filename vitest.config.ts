import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/core/vitest.config.ts",
      "packages/ui/vitest.config.ts",
      "apps/web/vitest.config.ts",
      "apps/extension/vitest.config.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text"],
      include: [
        "packages/core/src/**/*.ts",
        "packages/ui/src/**/*.{ts,tsx}",
        "apps/web/src/**/*.ts",
        "apps/extension/src/**/*.ts",
        "apps/extension/entrypoints/background.ts",
      ],
      exclude: ["**/*.d.ts", "**/types.ts", "**/index.ts"],
      thresholds: {
        branches: 90,
        functions: 92,
        lines: 92,
        statements: 92,
      },
    },
  },
});
