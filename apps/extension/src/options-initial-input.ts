import {
  claimSelectionHandoffMessageType,
  getHandoffIdFromSearch,
  handoffQueryParameter,
} from "./selection-handoff";

export interface OptionsRuntimeMessenger {
  sendMessage(message: {
    type: typeof claimSelectionHandoffMessageType;
    handoffId: string;
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- The runtime response is untrusted until claimOptionsInitialInput validates it.
  }): Promise<unknown>;
}

export const claimOptionsInitialInput = async (
  search: string,
  runtime: OptionsRuntimeMessenger,
) => {
  const handoffId = getHandoffIdFromSearch(search);
  if (!handoffId) {
    return new URLSearchParams(search).has(handoffQueryParameter) ? null : "";
  }

  try {
    const response = await runtime.sendMessage({
      type: claimSelectionHandoffMessageType,
      handoffId,
    });
    return typeof response === "string" && response.length > 0 ? response : null;
  } catch {
    return null;
  }
};
