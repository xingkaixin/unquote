import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "ui-agent-domain",
    environment: "node",
    include: [
      "tests/agent-session-model.test.ts",
      "tests/agent-session-shared.test.ts",
      "tests/agent-trajectory-model.test.ts",
      "tests/agent-trajectory-presentation.test.ts",
      "tests/claude-adapter.test.ts",
      "tests/codex-adapter.test.ts",
    ],
  },
});
