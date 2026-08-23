import { describe, expect, it, vi } from "vitest";
import { reportDiagnostic, serializeDiagnosticError } from "../src/lib/diagnostics";

describe("diagnostics", () => {
  it("serializes Error details for cross-thread reporting", () => {
    const error = new TypeError("read failed");

    expect(serializeDiagnosticError(error)).toMatchObject({
      name: "TypeError",
      message: "read failed",
      stack: expect.stringContaining("TypeError: read failed"),
    });
  });

  it("reports structured details without changing recovery state", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    reportDiagnostic("source.read", new Error("read failed"));

    expect(consoleError).toHaveBeenCalledWith(
      "[Unquote] source.read",
      expect.objectContaining({ name: "Error", message: "read failed" }),
    );
    consoleError.mockRestore();
  });

  it("preserves serialized worker diagnostics", () => {
    expect(
      serializeDiagnosticError({ name: "RangeError", message: "Invalid string length" }),
    ).toEqual({ name: "RangeError", message: "Invalid string length" });
  });
});
