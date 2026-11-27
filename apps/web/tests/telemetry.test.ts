import { afterEach, describe, expect, it, vi } from "vitest";
import { trackAnalyticsEvent } from "../src/telemetry";

describe("web analytics bridge", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards structured event payloads with the current page tag", () => {
    const track = vi.fn();
    vi.stubGlobal("window", { umami: { track } });

    trackAnalyticsEvent(
      {
        name: "parse-source",
        data: { input: "text", mode: "sse", format: "sse", agent: "false" },
      },
      "zh-CN:sse-viewer",
    );

    expect(track).toHaveBeenCalledWith("parse-source", {
      input: "text",
      mode: "sse",
      format: "sse",
      agent: "false",
      page: "zh-CN:sse-viewer",
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
