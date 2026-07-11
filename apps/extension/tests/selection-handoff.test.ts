import { describe, expect, it, vi } from "vitest";
import {
  claimSelectionHandoffMessageType,
  createSelectionHandoff,
  createSelectionHandoffClaimer,
  getHandoffIdFromSearch,
  selectionHandoffTtlMs,
  type HandoffSessionStorage,
} from "../src/selection-handoff";

const firstHandoffId = "00000000-0000-4000-8000-000000000001";
const secondHandoffId = "00000000-0000-4000-8000-000000000002";

class MemoryStorage implements HandoffSessionStorage {
  readonly values = new Map<string, unknown>();

  async get(key: string) {
    return { [key]: this.values.get(key) };
  }

  async remove(key: string) {
    this.values.delete(key);
  }

  async set(items: Record<string, unknown>) {
    Object.entries(items).forEach(([key, value]) => this.values.set(key, value));
  }
}

const claimMessage = (handoffId: string) => ({
  type: claimSelectionHandoffMessageType,
  handoffId,
});

describe("selection handoff", () => {
  it("claims concurrent selections by their own IDs in reverse order", async () => {
    const storage = new MemoryStorage();
    await createSelectionHandoff(storage, "first", {
      createId: () => firstHandoffId,
      now: () => 100,
    });
    await createSelectionHandoff(storage, "second", {
      createId: () => secondHandoffId,
      now: () => 100,
    });
    const claim = createSelectionHandoffClaimer(storage, () => 100);

    await expect(claim(claimMessage(secondHandoffId))).resolves.toBe("second");
    await expect(claim(claimMessage(firstHandoffId))).resolves.toBe("first");
  });

  it("returns an input only once and removes the consumed handoff", async () => {
    const storage = new MemoryStorage();
    await createSelectionHandoff(storage, "first", {
      createId: () => firstHandoffId,
      now: () => 100,
    });
    const claim = createSelectionHandoffClaimer(storage, () => 100);

    await expect(claim(claimMessage(firstHandoffId))).resolves.toBe("first");
    await expect(claim(claimMessage(firstHandoffId))).resolves.toBe("");
    expect(storage.values).toHaveLength(0);
  });

  it("rejects a duplicate claim while the first claim is in flight", async () => {
    let releaseGet: (() => void) | undefined;
    const storage: HandoffSessionStorage = {
      get: vi.fn(
        (key: string) =>
          new Promise<Record<string, unknown>>((resolve) => {
            releaseGet = () => resolve({ [key]: { input: "first", expiresAt: 200 } });
          }),
      ),
      remove: vi.fn(async () => {}),
      set: vi.fn(async () => {}),
    };
    const claim = createSelectionHandoffClaimer(storage, () => 100);
    const firstClaim = claim(claimMessage(firstHandoffId));

    await vi.waitFor(() => expect(storage.get).toHaveBeenCalledOnce());
    await expect(claim(claimMessage(firstHandoffId))).resolves.toBe("");
    releaseGet?.();
    await expect(firstClaim).resolves.toBe("first");
    expect(storage.get).toHaveBeenCalledOnce();
  });

  it("releases completed claim IDs instead of retaining every consumed UUID", async () => {
    const storage = new MemoryStorage();
    const claim = createSelectionHandoffClaimer(storage, () => 100);
    const handoffIds = Array.from(
      { length: 500 },
      (_, index) => `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
    );

    for (const handoffId of handoffIds) {
      await createSelectionHandoff(storage, `first-${handoffId}`, {
        createId: () => handoffId,
        now: () => 100,
      });
      await expect(claim(claimMessage(handoffId))).resolves.toBe(`first-${handoffId}`);
    }

    for (const handoffId of handoffIds) {
      await createSelectionHandoff(storage, `second-${handoffId}`, {
        createId: () => handoffId,
        now: () => 100,
      });
      await expect(claim(claimMessage(handoffId))).resolves.toBe(`second-${handoffId}`);
    }

    expect(storage.values).toHaveLength(0);
  });

  it("rejects malformed messages and reclaims expired handoffs", async () => {
    const storage = new MemoryStorage();
    await createSelectionHandoff(storage, "expired", {
      createId: () => firstHandoffId,
      now: () => 100,
    });
    const claim = createSelectionHandoffClaimer(storage, () => 100 + selectionHandoffTtlMs + 1);

    await expect(
      claim({ type: claimSelectionHandoffMessageType, handoffId: "invalid" }),
    ).resolves.toBe("");
    await expect(claim(claimMessage(firstHandoffId))).resolves.toBe("");
    expect(storage.values).toHaveLength(0);
  });

  it("returns empty input when session storage is unavailable", async () => {
    const storage: HandoffSessionStorage = {
      get: vi.fn(async () => {
        throw new Error("storage unavailable");
      }),
      remove: vi.fn(async () => {
        throw new Error("storage unavailable");
      }),
      set: vi.fn(async () => {
        throw new Error("storage unavailable");
      }),
    };

    await expect(createSelectionHandoff(storage, "first")).resolves.toBeNull();
    await expect(
      createSelectionHandoffClaimer(storage)(claimMessage(firstHandoffId)),
    ).resolves.toBe("");
  });

  it("reads only a valid handoff ID from the options URL", () => {
    expect(getHandoffIdFromSearch(`?handoff=${firstHandoffId}`)).toBe(firstHandoffId);
    expect(getHandoffIdFromSearch("?handoff=selection-text")).toBeNull();
    expect(getHandoffIdFromSearch("")).toBeNull();
  });
});
