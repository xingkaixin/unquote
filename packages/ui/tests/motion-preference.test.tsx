import { afterEach, describe, expect, it, vi } from "vitest";
import { preferredScrollBehavior } from "../src/lib/motion-preference";

describe("preferredScrollBehavior", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("disables smooth scrolling when reduced motion is preferred", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );

    expect(preferredScrollBehavior()).toBe("auto");
  });

  it("keeps smooth scrolling without a reduced-motion preference", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    );

    expect(preferredScrollBehavior()).toBe("smooth");
  });

  it("falls back to smooth scrolling when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);

    expect(preferredScrollBehavior()).toBe("smooth");
  });
});
