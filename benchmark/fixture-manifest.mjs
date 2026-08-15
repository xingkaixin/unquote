export const agentSessionFixturePath = "benchmark/case1-agent-session.jsonl";
export const agentSessionStressFixturePath = "benchmark/case1-agent-session-5K.jsonl";

export const defaultBenchmarkFixtures = [
  { path: agentSessionFixturePath, scenario: "agent-session" },
  { path: agentSessionStressFixturePath, scenario: "agent-session" },
  { path: "benchmark/case2-1MB.jsonl", scenario: "jsonl" },
  { path: "benchmark/case2-5MB.jsonl", scenario: "jsonl" },
  { path: "benchmark/case2-10MB.jsonl", scenario: "jsonl" },
  { path: "benchmark/case4-5K-rows.jsonl", scenario: "jsonl" },
];

export const defaultBenchmarkFixturePaths = defaultBenchmarkFixtures.map(({ path }) => path);

export const benchmarkScenarioFor = (fixturePath) =>
  defaultBenchmarkFixtures.find(({ path }) => path === fixturePath)?.scenario ?? "custom";
