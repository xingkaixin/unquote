import { describe, expect, it, vi } from "vitest";
import {
  claimSelectionHandoffMessageType,
  createSelectionHandoffStore,
  getHandoffIdFromSearch,
  selectionHandoffCleanupAlarmName,
  selectionHandoffTtlMs,
  type HandoffAlarms,
  type HandoffSessionStorage,
} from "../src/selection-handoff";

const firstHandoffId = "00000000-0000-4000-8000-000000000001";
const secondHandoffId = "00000000-0000-4000-8000-000000000002";
const handoffStorageKey = (handoffId: string) => `unquote:selection-handoff:${handoffId}`;

class MemoryStorage implements HandoffSessionStorage {
  readonly values = new Map<string, unknown>();
  removeFailures = 0;

  async get(key: string | null) {
    return key === null ? Object.fromEntries(this.values) : { [key]: this.values.get(key) };
  }

  async remove(key: string | string[]) {
    if (this.removeFailures > 0) {
      this.removeFailures -= 1;
      throw new Error("remove unavailable");
    }

    for (const item of Array.isArray(key) ? key : [key]) {
      this.values.delete(item);
    }
  }

  async set(items: Record<string, unknown>) {
    Object.entries(items).forEach(([key, value]) => this.values.set(key, value));
  }
}

class MemoryAlarms implements HandoffAlarms {
  readonly values = new Map<string, { when: number }>();
  createFailures = 0;

  readonly clear = vi.fn(async (name: string) => this.values.delete(name));
  readonly create = vi.fn(async (name: string, alarmInfo: { when: number }) => {
    if (this.createFailures > 0) {
      this.createFailures -= 1;
      throw new Error("alarms unavailable");
    }
    this.values.set(name, alarmInfo);
  });
}

const claimMessage = (handoffId: string) => ({
  type: claimSelectionHandoffMessageType,
  handoffId,
});

describe("selection handoff", () => {
  it("claims concurrent selections by their own IDs in reverse order", async () => {
    const storage = new MemoryStorage();
    const alarms = new MemoryAlarms();
    const createId = vi
      .fn<() => string>()
      .mockReturnValueOnce(firstHandoffId)
      .mockReturnValueOnce(secondHandoffId);
    const handoffs = createSelectionHandoffStore(storage, alarms, {
      createId,
      now: () => 100,
    });

    await handoffs.create("first");
    await handoffs.create("second");

    await expect(handoffs.claim(claimMessage(secondHandoffId))).resolves.toBe("second");
    await expect(handoffs.claim(claimMessage(firstHandoffId))).resolves.toBe("first");
  });

  it("returns an input only once and removes the consumed handoff", async () => {
    const storage = new MemoryStorage();
    const handoffs = createSelectionHandoffStore(storage, new MemoryAlarms(), {
      createId: () => firstHandoffId,
      now: () => 100,
    });
    await handoffs.create("first");

    await expect(handoffs.claim(claimMessage(firstHandoffId))).resolves.toBe("first");
    await expect(handoffs.claim(claimMessage(firstHandoffId))).resolves.toBe("");
    expect(storage.values).toHaveLength(0);
  });

  it("rejects a duplicate claim while the first claim is in flight", async () => {
    let releaseGet: (() => void) | undefined;
    const key = handoffStorageKey(firstHandoffId);
    const storage: HandoffSessionStorage = {
      get: vi.fn(
        () =>
          new Promise<Record<string, unknown>>((resolve) => {
            releaseGet = () => resolve({ [key]: { input: "first", expiresAt: 200 } });
          }),
      ),
      remove: vi.fn(async () => {}),
      set: vi.fn(async () => {}),
    };
    const handoffs = createSelectionHandoffStore(storage, new MemoryAlarms(), {
      now: () => 100,
    });
    const firstClaim = handoffs.claim(claimMessage(firstHandoffId));

    await vi.waitFor(() => expect(storage.get).toHaveBeenCalledOnce());
    await expect(handoffs.claim(claimMessage(firstHandoffId))).resolves.toBe("");
    releaseGet?.();
    await expect(firstClaim).resolves.toBe("first");
    expect(storage.get).toHaveBeenCalledOnce();
  });

  it("releases completed claim IDs instead of retaining every consumed UUID", async () => {
    const storage = new MemoryStorage();
    const handoffIds = Array.from(
      { length: 500 },
      (_, index) => `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
    );
    let created = 0;
    const handoffs = createSelectionHandoffStore(storage, new MemoryAlarms(), {
      createId: () => handoffIds[created++ % handoffIds.length]!,
      now: () => 100,
    });

    for (const handoffId of handoffIds) {
      await handoffs.create(`first-${handoffId}`);
      await expect(handoffs.claim(claimMessage(handoffId))).resolves.toBe(`first-${handoffId}`);
    }

    for (const handoffId of handoffIds) {
      await handoffs.create(`second-${handoffId}`);
      await expect(handoffs.claim(claimMessage(handoffId))).resolves.toBe(`second-${handoffId}`);
    }

    expect(storage.values).toHaveLength(0);
  });

  it("deletes an unclaimed handoff when its expiry alarm fires", async () => {
    let currentTime = 100;
    const storage = new MemoryStorage();
    const alarms = new MemoryAlarms();
    const handoffs = createSelectionHandoffStore(storage, alarms, {
      createId: () => firstHandoffId,
      now: () => currentTime,
    });

    await expect(handoffs.create("private selection")).resolves.toBe(firstHandoffId);
    expect(alarms.values.get(selectionHandoffCleanupAlarmName)).toEqual({
      when: 100 + selectionHandoffTtlMs,
    });
    expect(JSON.stringify(alarms.create.mock.calls)).not.toContain("private selection");

    currentTime += selectionHandoffTtlMs + 1;
    await handoffs.handleAlarm({ name: selectionHandoffCleanupAlarmName });

    expect(storage.values).toHaveLength(0);
  });

  it("recovers cleanup after a background restart without removing live handoffs", async () => {
    let currentTime = 100;
    const storage = new MemoryStorage();
    const firstStore = createSelectionHandoffStore(storage, new MemoryAlarms(), {
      createId: () => firstHandoffId,
      now: () => currentTime,
    });
    await firstStore.create("still live");

    const restartedAlarms = new MemoryAlarms();
    const restartedStore = createSelectionHandoffStore(storage, restartedAlarms, {
      now: () => currentTime,
    });
    await restartedStore.sweep();

    expect(storage.values).toHaveLength(1);
    expect(restartedAlarms.values.get(selectionHandoffCleanupAlarmName)).toEqual({
      when: 100 + selectionHandoffTtlMs,
    });

    currentTime += selectionHandoffTtlMs + 1;
    await createSelectionHandoffStore(storage, new MemoryAlarms(), {
      now: () => currentTime,
    }).sweep();
    expect(storage.values).toHaveLength(0);
  });

  it("sweeps expired and structurally invalid handoffs without touching other session data", async () => {
    const storage = new MemoryStorage();
    storage.values.set(handoffStorageKey(firstHandoffId), { input: "expired", expiresAt: 99 });
    storage.values.set(handoffStorageKey(secondHandoffId), { input: 42, expiresAt: 200 });
    storage.values.set("unquote:selection-handoff:not-a-uuid", {
      input: "invalid",
      expiresAt: 200,
    });
    storage.values.set("unrelated", "keep");
    const handoffs = createSelectionHandoffStore(storage, new MemoryAlarms(), {
      now: () => 100,
    });

    await handoffs.sweep();

    expect(Object.fromEntries(storage.values)).toEqual({ unrelated: "keep" });
  });

  it("retries cleanup after removal fails", async () => {
    const storage = new MemoryStorage();
    storage.values.set(handoffStorageKey(firstHandoffId), { input: "expired", expiresAt: 99 });
    storage.removeFailures = 1;
    const alarms = new MemoryAlarms();
    const handoffs = createSelectionHandoffStore(storage, alarms, { now: () => 100 });

    await handoffs.handleAlarm({ name: selectionHandoffCleanupAlarmName });
    expect(storage.values).toHaveLength(1);
    expect(alarms.values.get(selectionHandoffCleanupAlarmName)).toEqual({ when: 30_100 });

    await handoffs.handleAlarm({ name: selectionHandoffCleanupAlarmName });
    expect(storage.values).toHaveLength(0);
  });

  it("does not reveal a handoff until its one-time removal succeeds", async () => {
    const storage = new MemoryStorage();
    storage.values.set(handoffStorageKey(firstHandoffId), { input: "first", expiresAt: 200 });
    storage.removeFailures = 1;
    const handoffs = createSelectionHandoffStore(storage, new MemoryAlarms(), { now: () => 100 });

    await expect(handoffs.claim(claimMessage(firstHandoffId))).resolves.toBe("");
    await expect(handoffs.claim(claimMessage(firstHandoffId))).resolves.toBe("first");
    expect(storage.values).toHaveLength(0);
  });

  it("removes a new handoff when its retention alarm cannot be scheduled", async () => {
    const storage = new MemoryStorage();
    const alarms = new MemoryAlarms();
    alarms.createFailures = 1;
    const handoffs = createSelectionHandoffStore(storage, alarms, {
      createId: () => firstHandoffId,
      now: () => 100,
    });

    await expect(handoffs.create("first")).resolves.toBeNull();
    expect(storage.values).toHaveLength(0);
  });

  it("sweeps expired handoffs even when a claim message is malformed", async () => {
    const storage = new MemoryStorage();
    storage.values.set(handoffStorageKey(firstHandoffId), { input: "expired", expiresAt: 99 });
    const handoffs = createSelectionHandoffStore(storage, new MemoryAlarms(), { now: () => 100 });

    await expect(
      handoffs.claim({ type: claimSelectionHandoffMessageType, handoffId: "invalid" }),
    ).resolves.toBe("");
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
    const handoffs = createSelectionHandoffStore(storage, new MemoryAlarms());

    await expect(handoffs.create("first")).resolves.toBeNull();
    await expect(handoffs.claim(claimMessage(firstHandoffId))).resolves.toBe("");
  });

  it("reads only a valid handoff ID from the options URL", () => {
    expect(getHandoffIdFromSearch(`?handoff=${firstHandoffId}`)).toBe(firstHandoffId);
    expect(getHandoffIdFromSearch("?handoff=selection-text")).toBeNull();
    expect(getHandoffIdFromSearch("")).toBeNull();
  });
});
