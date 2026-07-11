export const claimSelectionHandoffMessageType = "unquote:claim-selection-handoff";
export const handoffQueryParameter = "handoff";
export const selectionHandoffTtlMs = 5 * 60 * 1000;

const handoffKeyPrefix = "unquote:selection-handoff:";
const handoffIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SelectionHandoff {
  input: string;
  expiresAt: number;
}

export interface HandoffSessionStorage {
  get(key: string): Promise<Record<string, unknown>>;
  remove(key: string): Promise<void>;
  set(items: Record<string, unknown>): Promise<void>;
}

interface CreateSelectionHandoffOptions {
  createId?: () => string;
  now?: () => number;
}

const isHandoffId = (value: unknown): value is string =>
  typeof value === "string" && handoffIdPattern.test(value);

const handoffKey = (handoffId: string) => `${handoffKeyPrefix}${handoffId}`;

const isSelectionHandoff = (value: unknown): value is SelectionHandoff => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const handoff = value as { input?: unknown; expiresAt?: unknown };
  return typeof handoff.input === "string" && typeof handoff.expiresAt === "number";
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

export const createSelectionHandoff = async (
  storage: HandoffSessionStorage,
  input: string,
  options: CreateSelectionHandoffOptions = {},
) => {
  const handoffId = options.createId ? options.createId() : crypto.randomUUID();
  const expiresAt = (options.now ?? Date.now)() + selectionHandoffTtlMs;

  try {
    await storage.set({ [handoffKey(handoffId)]: { input, expiresAt } });
    return handoffId;
  } catch {
    return null;
  }
};

export const createSelectionHandoffClaimer = (
  storage: HandoffSessionStorage,
  now: () => number = Date.now,
) => {
  const claimedHandoffIds = new Set<string>();

  return async (message: unknown) => {
    const handoffId = getClaimedHandoffId(message);
    if (!handoffId || claimedHandoffIds.has(handoffId)) {
      return "";
    }

    claimedHandoffIds.add(handoffId);
    const key = handoffKey(handoffId);
    try {
      const result = await storage.get(key);
      const handoff = result[key];
      return isSelectionHandoff(handoff) && handoff.expiresAt > now() ? handoff.input : "";
    } catch {
      return "";
    } finally {
      try {
        await storage.remove(key);
      } catch {
        // A later storage cleanup can reclaim the expired or consumed handoff.
      }
      claimedHandoffIds.delete(handoffId);
    }
  };
};
