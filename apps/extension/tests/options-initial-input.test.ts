import { describe, expect, it, vi } from "vitest";
import { claimOptionsInitialInput } from "../src/options-initial-input";
import { claimSelectionHandoffMessageType } from "../src/selection-handoff";

const handoffId = "00000000-0000-4000-8000-000000000001";

describe("options initial input", () => {
  it("claims a valid handoff from the options URL", async () => {
    const runtime = { sendMessage: vi.fn(async (_message: unknown) => "selected input") };

    await expect(claimOptionsInitialInput(`?handoff=${handoffId}`, runtime)).resolves.toBe(
      "selected input",
    );
    expect(runtime.sendMessage).toHaveBeenCalledWith({
      type: claimSelectionHandoffMessageType,
      handoffId,
    });
  });

  it.each(["", "?other=keep"])(
    "renders empty input without messaging for search %j",
    async (search) => {
      const runtime = { sendMessage: vi.fn(async (_message: unknown) => "unexpected") };

      await expect(claimOptionsInitialInput(search, runtime)).resolves.toBe("");
      expect(runtime.sendMessage).not.toHaveBeenCalled();
    },
  );

  it.each(["?handoff=failed", "?handoff=invalid", "?handoff="])(
    "reports failed handoff %s without messaging",
    async (search) => {
      const runtime = { sendMessage: vi.fn() };
      await expect(claimOptionsInitialInput(search, runtime)).resolves.toBeNull();
      expect(runtime.sendMessage).not.toHaveBeenCalled();
    },
  );

  it.each(["", undefined, null, 42, { input: "selected input" }])(
    "reports an unavailable runtime response %j",
    async (response) => {
      const runtime = { sendMessage: vi.fn(async (_message: unknown) => response) };

      await expect(claimOptionsInitialInput(`?handoff=${handoffId}`, runtime)).resolves.toBeNull();
    },
  );

  it("reports failure when the runtime claim rejects", async () => {
    const runtime = {
      sendMessage: vi.fn(async (_message: unknown) => {
        throw new Error("background unavailable");
      }),
    };

    await expect(claimOptionsInitialInput(`?handoff=${handoffId}`, runtime)).resolves.toBeNull();
  });
});
