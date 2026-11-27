import { afterEach, describe, expect, it, vi } from "vitest";
import { trackAnalyticsEvent } from "../src/telemetry";

describe("web analytics bridge", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps text parses to paste-json, samples to load-sample, and forwards other events", () => {
    const track = vi.fn();
    vi.stubGlobal("window", { umami: { track } });

    trackAnalyticsEvent(
      {
        name: "parse-source",
        data: { input: "text", mode: "sse", format: "sse", agent: "false" },
      },
      "zh-CN:sse-viewer",
    );
    trackAnalyticsEvent(
      {
        name: "parse-source",
        data: { input: "file", mode: "jsonl", format: "jsonl", agent: "true" },
      },
      "en:agent-log-viewer",
    );
    trackAnalyticsEvent({ name: "sample-select", data: { sample: "codex-rollout-jsonl" } }, "home");

    expect(track).toHaveBeenNthCalledWith(1, "paste-json", {
      mode: "sse",
      format: "sse",
      agent: "false",
      page: "zh-CN:sse-viewer",
    });
    expect(track).toHaveBeenNthCalledWith(2, "parse-source", {
      input: "file",
      mode: "jsonl",
      format: "jsonl",
      agent: "true",
      page: "en:agent-log-viewer",
    });
    expect(track).toHaveBeenNthCalledWith(3, "load-sample", {
      sample: "codex-rollout-jsonl",
      page: "home",
    });
  });

  it("stays silent when Umami is unavailable or throws", () => {
    expect(() =>
      trackAnalyticsEvent({ name: "sample-select", data: { sample: "sse-stream" } }, "home"),
    ).not.toThrow();

    vi.stubGlobal("window", {
      umami: {
        track: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(() =>
      trackAnalyticsEvent({ name: "switch-view", data: { view: "trajectory" } }, "home"),
    ).not.toThrow();
  });
});
