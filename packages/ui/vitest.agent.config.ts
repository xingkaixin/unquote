import { defineProject } from "vitest/config";
import svgr from "vite-plugin-svgr";

export default defineProject({
  plugins: [svgr()],
  test: {
    name: "ui-agent-domain",
    environment: "node",
    include: ["tests/**/*.test.ts"],
    maxWorkers: "25%",
    sequence: { groupOrder: 1 },
  },
});
