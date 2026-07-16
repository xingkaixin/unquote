const legacySourceHashPrefix = "#data=";

type BrowserLocation = Pick<Location, "hash" | "pathname" | "search">;
type BrowserHistory = Pick<History, "replaceState" | "state">;

export const clearLegacySourceHash = (location: BrowserLocation, history: BrowserHistory) => {
  if (!location.hash.startsWith(legacySourceHashPrefix)) {
    return;
  }

  history.replaceState(history.state, "", `${location.pathname}${location.search}`);
};
