import { claimSelectionHandoffMessageType, getHandoffIdFromSearch } from "./selection-handoff";

export interface OptionsRuntimeMessenger {
  sendMessage(message: unknown): Promise<unknown>;
}

export const claimOptionsInitialInput = async (
  search: string,
  runtime: OptionsRuntimeMessenger,
) => {
  const handoffId = getHandoffIdFromSearch(search);
  if (!handoffId) {
    return "";
  }

  try {
    const response = await runtime.sendMessage({
      type: claimSelectionHandoffMessageType,
      handoffId,
    });
    return typeof response === "string" ? response : "";
  } catch {
    return "";
  }
};
