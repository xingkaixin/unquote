import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "ui-browser",
    environment: "jsdom",
    include: ["tests/**/*.test.tsx"],
    setupFiles: ["./tests/setup.ts"],
  },
});
