import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "ui-agent-domain",
    environment: "node",
    include: ["tests/**/*.test.ts"],
    maxWorkers: "50%",
    sequence: { groupOrder: 1 },
  },
});
