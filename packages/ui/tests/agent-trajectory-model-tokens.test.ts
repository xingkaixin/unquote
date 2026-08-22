import { describe, expect, it } from "vitest";
import { createAgentTrajectoryModel } from "../src/lib/agent-session";
import {
  event,
  session,
  conversation,
  modelOutput,
  toolCall,
  toolResult,
  tokenUsage,
  tokenUsageWithCumulative,
  cumulativeTokenUsage,
  itemById,
  toolItems,
  warningKinds,
} from "./agent-trajectory-model.support";

describe("createAgentTrajectoryModel: tokens", () => {
  it("attaches sparse token usage only to the prior model output while retaining safe totals", () => {
    const firstAssistant = conversation("first-assistant", "assistant");
    const firstReasoning = conversation("first-reasoning", "thinking");
    const secondAssistant = conversation("second-assistant", "assistant");
    const model = createAgentTrajectoryModel(
      session([
        event("early-first-token", "record-early-first-token", 1, {
          turnIndex: 1,
          sessionEvidence: [tokenUsage({ inputTokens: 99 }, "turn-one")],
        }),
        event("first-assistant", "record-first-assistant", 2, {
          turnIndex: 1,
          conversationItems: [firstAssistant],
          sessionEvidence: [{ ...modelOutput("assistant", firstAssistant.id), turnId: "turn-one" }],
        }),
        event("first-reasoning", "record-first-reasoning", 3, {
          turnIndex: 1,
          conversationItems: [firstReasoning],
          sessionEvidence: [{ ...modelOutput("reasoning", firstReasoning.id), turnId: "turn-one" }],
        }),
        event("first-token", "record-first-token", 4, {
          turnIndex: 1,
          sessionEvidence: [
            tokenUsage({ inputTokens: 3, cacheCreationInputTokens: 2 }, "turn-one"),
          ],
        }),
        event("second-first-token", "record-second-first-token", 5, {
          turnIndex: 1,
          sessionEvidence: [tokenUsage({ outputTokens: 4 }, "turn-one")],
        }),
        event("early-second-token", "record-early-second-token", 6, {
          turnIndex: 2,
          sessionEvidence: [tokenUsage({ outputTokens: 50 }, "turn-two")],
        }),
        event("second-assistant", "record-second-assistant", 7, {
          turnIndex: 2,
          conversationItems: [secondAssistant],
          sessionEvidence: [
            { ...modelOutput("assistant", secondAssistant.id), turnId: "turn-two" },
          ],
        }),
        event("second-token", "record-second-token", 8, {
          turnIndex: 2,
          sessionEvidence: [
            tokenUsage({ inputTokens: 5, cacheReadInputTokens: 7, outputTokens: 1 }, "turn-two"),
          ],
        }),
        event("invalid-token", "record-invalid-token", 9, {
          turnIndex: 2,
          sessionEvidence: [
            tokenUsage(
              {
                inputTokens: -1,
                cacheReadInputTokens: Number.POSITIVE_INFINITY,
                outputTokens: Number.MAX_SAFE_INTEGER,
              },
              "turn-two",
            ),
          ],
        }),
        event("unscoped-token", "record-unscoped-token", 10, {
          sessionEvidence: [tokenUsage({ outputTokens: 30 })],
        }),
      ]),
    );

    expect(itemById(model, "first-assistant:evidence-0").tokenUsage).toBeUndefined();
    expect(itemById(model, "first-reasoning:evidence-0").tokenUsage).toEqual({
      inputTokens: 3,
      cacheCreationInputTokens: 2,
      outputTokens: 4,
    });
    expect(itemById(model, "second-assistant:evidence-0").tokenUsage).toEqual({
      inputTokens: 5,
      cacheReadInputTokens: 7,
      outputTokens: 1,
    });
    expect(model.stats.tokenUsage).toEqual({
      inputTokens: 107,
      cacheCreationInputTokens: 2,
      cacheReadInputTokens: 7,
      outputTokens: 85,
    });
    expect(warningKinds(model).filter((kind) => kind === "unattached-token-usage")).toHaveLength(3);
  });

  it("uses cumulative snapshots for totals without double counting incremental usage", () => {
    const firstAssistant = conversation("snapshot-first", "assistant");
    const secondAssistant = conversation("snapshot-second", "assistant");
    const model = createAgentTrajectoryModel(
      session([
        event("snapshot-first", "record-snapshot-first", 1, {
          turnIndex: 1,
          conversationItems: [firstAssistant],
          sessionEvidence: [
            { ...modelOutput("assistant", firstAssistant.id), turnId: "snapshot-turn" },
          ],
        }),
        event("snapshot-first-token", "record-snapshot-first-token", 2, {
          turnIndex: 1,
          sessionEvidence: [
            tokenUsageWithCumulative(
              { inputTokens: 100, outputTokens: 10 },
              { inputTokens: 100, outputTokens: 10 },
              "snapshot-turn",
            ),
          ],
        }),
        event("snapshot-second", "record-snapshot-second", 3, {
          turnIndex: 1,
          conversationItems: [secondAssistant],
          sessionEvidence: [
            { ...modelOutput("assistant", secondAssistant.id), turnId: "snapshot-turn" },
          ],
        }),
        event("snapshot-second-token", "record-snapshot-second-token", 4, {
          turnIndex: 1,
          sessionEvidence: [
            tokenUsageWithCumulative(
              { inputTokens: 20, outputTokens: 5 },
              { inputTokens: 120, outputTokens: 15 },
              "snapshot-turn",
            ),
          ],
        }),
      ]),
    );

    expect(itemById(model, "snapshot-first:evidence-0").tokenUsage).toEqual({
      inputTokens: 100,
      outputTokens: 10,
    });
    expect(itemById(model, "snapshot-second:evidence-0").tokenUsage).toEqual({
      inputTokens: 20,
      outputTokens: 5,
    });
    expect(model.stats.tokenUsage).toEqual({ inputTokens: 120, outputTokens: 15 });
  });

  it("merges incremental and cumulative token components per key", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("initial-snapshot", "record-initial-snapshot", 1, {
          sessionEvidence: [
            cumulativeTokenUsage({ inputTokens: 100, outputTokens: 10 }, "partial-snapshot-turn"),
          ],
        }),
        event("partial-snapshot", "record-partial-snapshot", 2, {
          sessionEvidence: [
            tokenUsageWithCumulative(
              { inputTokens: 999, outputTokens: 3, reasoningOutputTokens: 7 },
              { inputTokens: 120, cacheReadInputTokens: 5 },
              "partial-snapshot-turn",
            ),
          ],
        }),
      ]),
    );

    expect(model.stats.tokenUsage).toEqual({
      inputTokens: 120,
      cacheReadInputTokens: 5,
      outputTokens: 13,
      reasoningOutputTokens: 7,
    });
  });

  it("retains prior cumulative components when a later snapshot omits them", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("snapshot-one", "record-snapshot-one", 1, {
          sessionEvidence: [cumulativeTokenUsage({ inputTokens: 100, outputTokens: 10 })],
        }),
        event("snapshot-two", "record-snapshot-two", 2, {
          sessionEvidence: [cumulativeTokenUsage({ inputTokens: 120 })],
        }),
      ]),
    );

    expect(model.stats.tokenUsage).toEqual({ inputTokens: 120, outputTokens: 10 });
  });

  it("updates totals from cumulative-only evidence without an unattached warning", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("cumulative-only", "record-cumulative-only", 1, {
          turnIndex: 1,
          sessionEvidence: [
            cumulativeTokenUsage({ inputTokens: 50, outputTokens: 8 }, "cumulative-turn"),
          ],
        }),
      ]),
    );

    expect(model.stats.tokenUsage).toEqual({ inputTokens: 50, outputTokens: 8 });
    expect(warningKinds(model)).not.toContain("unattached-token-usage");
  });

  it("accumulates flat incremental usage without a cumulative snapshot", () => {
    const assistant = conversation("flat-incremental", "assistant");
    const model = createAgentTrajectoryModel(
      session([
        event("flat-incremental", "record-flat-incremental", 1, {
          turnIndex: 1,
          conversationItems: [assistant],
          sessionEvidence: [{ ...modelOutput("assistant", assistant.id), turnId: "flat-turn" }],
        }),
        event("flat-first", "record-flat-first", 2, {
          turnIndex: 1,
          sessionEvidence: [tokenUsage({ inputTokens: 2 }, "flat-turn")],
        }),
        event("flat-second", "record-flat-second", 3, {
          turnIndex: 1,
          sessionEvidence: [tokenUsage({ inputTokens: 3, outputTokens: 1 }, "flat-turn")],
        }),
      ]),
    );

    expect(itemById(model, "flat-incremental:evidence-0").tokenUsage).toEqual({
      inputTokens: 5,
      outputTokens: 1,
    });
    expect(model.stats.tokenUsage).toEqual({ inputTokens: 5, outputTokens: 1 });
  });

  it("continues flat increments after a cumulative snapshot and filters invalid fields", () => {
    const assistant = conversation("snapshot-increment", "assistant");
    const model = createAgentTrajectoryModel(
      session([
        event("snapshot-increment", "record-snapshot-increment", 1, {
          turnIndex: 1,
          conversationItems: [assistant],
          sessionEvidence: [
            { ...modelOutput("assistant", assistant.id), turnId: "snapshot-increment-turn" },
          ],
        }),
        event("snapshot", "record-snapshot", 2, {
          turnIndex: 1,
          sessionEvidence: [
            cumulativeTokenUsage(
              {
                inputTokens: 100,
                outputTokens: 10,
                cacheReadInputTokens: -1,
              },
              "snapshot-increment-turn",
            ),
          ],
        }),
        event("snapshot-after-increment", "record-snapshot-increment-after", 3, {
          turnIndex: 1,
          sessionEvidence: [
            tokenUsage(
              {
                inputTokens: 20,
                outputTokens: 5,
                cacheCreationInputTokens: Number.POSITIVE_INFINITY,
              },
              "snapshot-increment-turn",
            ),
          ],
        }),
        event("overflow", "record-overflow", 4, {
          turnIndex: 1,
          sessionEvidence: [
            tokenUsage(
              {
                inputTokens: Number.MAX_SAFE_INTEGER,
                outputTokens: Number.MAX_SAFE_INTEGER,
              },
              "snapshot-increment-turn",
            ),
          ],
        }),
      ]),
    );

    expect(itemById(model, "snapshot-increment:evidence-0").tokenUsage).toEqual({
      inputTokens: 20,
      outputTokens: 5,
    });
    expect(model.stats.tokenUsage).toEqual({ inputTokens: 120, outputTokens: 15 });
  });

  it("leaves missing and duplicate call ids unpaired", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("idless-call", "record-idless-call", 1, {
          turnIndex: 1,
          sessionEvidence: [{ ...toolCall("idless"), turnId: "turn" }],
        }),
        event("idless-result", "record-idless-result", 2, {
          turnIndex: 1,
          sessionEvidence: [{ ...toolResult("completed"), turnId: "turn" }],
        }),
        event("first-duplicate-call", "record-first-duplicate-call", 3, {
          turnIndex: 1,
          sessionEvidence: [{ ...toolCall("first", "duplicate"), turnId: "turn" }],
        }),
        event("second-duplicate-call", "record-second-duplicate-call", 4, {
          turnIndex: 1,
          sessionEvidence: [{ ...toolCall("second", "duplicate"), turnId: "turn" }],
        }),
        event("duplicate-result", "record-duplicate-result", 5, {
          turnIndex: 1,
          sessionEvidence: [{ ...toolResult("completed", "duplicate"), turnId: "turn" }],
        }),
      ]),
    );

    const duplicateItems = toolItems(model).filter((item) => item.callId === "duplicate");
    expect(toolItems(model)).toHaveLength(5);
    expect(duplicateItems).toHaveLength(3);
    expect(duplicateItems.every((item) => !(item.callSelection && item.resultSelection))).toBe(
      true,
    );
    expect(duplicateItems.map((item) => item.status)).toEqual(["running", "running", "completed"]);
    expect(warningKinds(model)).toEqual(
      expect.arrayContaining([
        "duplicate-tool-call-id",
        "unpaired-tool-call",
        "unpaired-tool-result",
      ]),
    );
  });
});
