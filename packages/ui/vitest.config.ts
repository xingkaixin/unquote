import { defineConfig } from "vitest/config";
import svgr from "vite-plugin-svgr";

export default defineConfig({
  plugins: [svgr()],
  test: {
    name: "ui-browser",
    environment: "jsdom",
    include: ["tests/**/*.test.tsx"],
    maxWorkers: "25%",
    sequence: { groupOrder: 1 },
    setupFiles: ["./tests/setup.ts"],
  },
});
