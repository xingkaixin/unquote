export const claimSelectionHandoffMessageType = "unquote:claim-selection-handoff";
export const handoffQueryParameter = "handoff";
export const selectionHandoffTtlMs = 5 * 60 * 1000;
export const selectionHandoffCleanupAlarmName = "unquote:selection-handoff-cleanup";

const cleanupRetryMs = 30 * 1000;
const handoffKeyPrefix = "unquote:selection-handoff:";
const handoffIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SelectionHandoff {
  input: string;
  expiresAt: number;
}

export interface HandoffSessionStorage {
  get(key: string | null): Promise<Record<string, unknown>>;
  remove(key: string | string[]): Promise<void>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface HandoffAlarms {
  clear(name: string): Promise<boolean> | boolean;
  create(name: string, alarmInfo: { when: number }): Promise<void> | void;
}

interface SelectionHandoffStoreOptions {
  createId?: () => string;
  now?: () => number;
}

interface ReconcileResult {
  claimedInput: string;
  retainedHandoffIds: Set<string>;
  retentionScheduled: boolean;
}

const isHandoffId = (value: unknown): value is string =>
  typeof value === "string" && handoffIdPattern.test(value);

const handoffKey = (handoffId: string) => `${handoffKeyPrefix}${handoffId}`;

const isSelectionHandoff = (value: unknown): value is SelectionHandoff => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const handoff = value as { input?: unknown; expiresAt?: unknown };
  return (
    typeof handoff.input === "string" &&
    typeof handoff.expiresAt === "number" &&
    Number.isFinite(handoff.expiresAt)
  );
};

const getClaimedHandoffId = (message: unknown) => {
  if (!message || typeof message !== "object") {
    return null;
  }

  const payload = message as { type?: unknown; handoffId?: unknown };
  return payload.type === claimSelectionHandoffMessageType && isHandoffId(payload.handoffId)
    ? payload.handoffId
    : null;
};

export const getHandoffIdFromSearch = (search: string) => {
  const handoffId = new URLSearchParams(search).get(handoffQueryParameter);
  return isHandoffId(handoffId) ? handoffId : null;
};

export const createSelectionHandoffStore = (
  storage: HandoffSessionStorage,
  alarms: HandoffAlarms,
  options: SelectionHandoffStoreOptions = {},
) => {
  const now = options.now ?? Date.now;
  const createId = options.createId ?? (() => crypto.randomUUID());
  const claimedHandoffIds = new Set<string>();
  // Every operation may replace the one cleanup alarm, so scheduling must follow storage order.
  let pendingOperation = Promise.resolve();

  const runExclusive = <T>(operation: () => Promise<T>) => {
    const result = pendingOperation.then(operation, operation);
    pendingOperation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const scheduleCleanup = async (when: number) => {
    try {
      await alarms.create(selectionHandoffCleanupAlarmName, { when });
      return true;
    } catch {
      return false;
    }
  };

  const clearCleanup = async () => {
    try {
      await alarms.clear(selectionHandoffCleanupAlarmName);
    } catch {
      return;
    }
  };

  const reconcile = async (claimedHandoffId?: string): Promise<ReconcileResult> => {
    const currentTime = now();
    let values: Record<string, unknown>;
    try {
      values = await storage.get(null);
    } catch {
      await scheduleCleanup(currentTime + cleanupRetryMs);
      return { claimedInput: "", retainedHandoffIds: new Set(), retentionScheduled: false };
    }

    const keysToRemove: string[] = [];
    let claimedInput = "";
    let nextExpiry = Number.POSITIVE_INFINITY;
    const retainedHandoffIds = new Set<string>();

    for (const [key, value] of Object.entries(values)) {
      if (!key.startsWith(handoffKeyPrefix)) {
        continue;
      }

      const handoffId = key.slice(handoffKeyPrefix.length);
      const handoff = isHandoffId(handoffId) && isSelectionHandoff(value) ? value : null;
      const isClaimed = handoffId === claimedHandoffId;
      if (!handoff || handoff.expiresAt <= currentTime || isClaimed) {
        keysToRemove.push(key);
      } else {
        nextExpiry = Math.min(nextExpiry, handoff.expiresAt);
        retainedHandoffIds.add(handoffId);
      }

      if (isClaimed && handoff && handoff.expiresAt > currentTime) {
        claimedInput = handoff.input;
      }
    }

    try {
      if (keysToRemove.length > 0) {
        await storage.remove(keysToRemove);
      }
    } catch {
      await scheduleCleanup(currentTime + cleanupRetryMs);
      return { claimedInput: "", retainedHandoffIds: new Set(), retentionScheduled: false };
    }

    if (Number.isFinite(nextExpiry)) {
      const retentionScheduled = await scheduleCleanup(nextExpiry);
      return { claimedInput, retainedHandoffIds, retentionScheduled };
    }

    await clearCleanup();
    return { claimedInput, retainedHandoffIds, retentionScheduled: true };
  };

  const sweep = () => runExclusive(() => reconcile()).then(() => undefined);

  const create = (input: string) =>
    runExclusive(async () => {
      const handoffId = createId();
      if (!isHandoffId(handoffId)) {
        return null;
      }

      const expiresAt = now() + selectionHandoffTtlMs;
      if (!Number.isFinite(expiresAt)) {
        return null;
      }
      try {
        await storage.set({ [handoffKey(handoffId)]: { input, expiresAt } });
      } catch {
        return null;
      }

      const { retainedHandoffIds, retentionScheduled } = await reconcile();
      if (retentionScheduled && retainedHandoffIds.has(handoffId)) {
        return handoffId;
      }

      try {
        await storage.remove(handoffKey(handoffId));
      } catch {
        return null;
      }
      await reconcile();
      return null;
    });

  const claim = (message: unknown) => {
    const handoffId = getClaimedHandoffId(message);
    if (!handoffId) {
      return sweep().then(() => "");
    }
    if (claimedHandoffIds.has(handoffId)) {
      return Promise.resolve("");
    }

    claimedHandoffIds.add(handoffId);
    return runExclusive(() => reconcile(handoffId))
      .then(({ claimedInput }) => claimedInput)
      .finally(() => claimedHandoffIds.delete(handoffId));
  };

  const handleAlarm = (alarm: { name: string }) =>
    alarm.name === selectionHandoffCleanupAlarmName ? sweep() : Promise.resolve();

  return { claim, create, handleAlarm, sweep };
};
