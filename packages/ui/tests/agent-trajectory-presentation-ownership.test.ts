import { describe, expect, it } from "vitest";
import { type AgentSessionModel } from "../src/lib/agent-session";
import { createAgentTrajectoryPresentation } from "../src/lib/agent-session/trajectory-presentation";
import {
  eventFor,
  modelOutputItemFor,
  turnFor,
  modelFor,
} from "./agent-trajectory-presentation.support";

describe("agent trajectory presentation: ownership", () => {
  it("does not modify readonly trajectory facts or search their collections repeatedly", () => {
    const item = modelOutputItemFor("event-40", "assistant", 10);
    const turn = turnFor("turn-readonly", [item], { startedAt: 0, endedAt: 20, durationMs: 20 });
    const base = modelFor([eventFor("event-40", "Readonly", "")], [item], [turn]);
    const canonicalItem = base.trajectory.items[0]!;
    const canonicalTurn = base.trajectory.turns[0]!;
    const guardedItems = new Proxy(base.trajectory.items, {
      get(target, property, receiver) {
        if (property === "find" || property === "filter") {
          throw new Error(`Unexpected item collection search: ${String(property)}`);
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const guardedTurns = new Proxy(base.trajectory.turns, {
      get(target, property, receiver) {
        if (property === "find" || property === "filter") {
          throw new Error(`Unexpected turn collection search: ${String(property)}`);
        }
        return Reflect.get(target, property, receiver);
      },
    });
    Object.freeze(canonicalItem.selection);
    Object.freeze(canonicalItem);
    Object.freeze(canonicalTurn);
    Object.freeze(base.trajectory.warnings);
    Object.freeze(base.trajectory);
    const model = {
      ...base,
      trajectory: {
        ...base.trajectory,
        items: guardedItems,
        turns: guardedTurns,
      },
    } satisfies AgentSessionModel;

    const presentation = createAgentTrajectoryPresentation(model);

    expect(presentation.items[0]?.item).toBe(canonicalItem);
    expect(base.trajectory.items).toEqual([canonicalItem]);
    expect(base.trajectory.turns).toEqual([canonicalTurn]);
  });
});
