import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "ui-browser",
    environment: "jsdom",
    include: ["tests/**/*.test.tsx"],
    maxWorkers: "25%",
    sequence: { groupOrder: 1 },
    setupFiles: ["./tests/setup.ts"],
  },
});
