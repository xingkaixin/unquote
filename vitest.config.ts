import { defineConfig } from "vitest/config";

const hotspotThresholds = {
  branches: 90,
  functions: 95,
  lines: 95,
  statements: 95,
};

export default defineConfig({
  test: {
    projects: [
      "packages/core/vitest.config.ts",
      "packages/ui/vitest.config.ts",
      "apps/web/vitest.config.ts",
      "apps/extension/vitest.config.ts",
      "benchmark/vitest.config.ts",
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
        branches: 88,
        functions: 92,
        lines: 92,
        statements: 92,
        "packages/ui/src/components/agent-session-view.tsx": hotspotThresholds,
        "packages/ui/src/components/command-palette.tsx": hotspotThresholds,
        "packages/ui/src/components/file-overview.tsx": hotspotThresholds,
        "packages/ui/src/hooks/use-parser.ts": hotspotThresholds,
        "packages/ui/src/hooks/use-source-loader.ts": hotspotThresholds,
        "packages/ui/src/lib/path-codec.ts": hotspotThresholds,
      },
    },
  },
});
