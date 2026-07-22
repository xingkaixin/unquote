import { useEffect, useMemo, useState } from "react";

const desktopWorkspaceQuery = "(min-width: 64rem)";

export const useDesktopWorkspace = () => {
  const mediaQuery = useMemo(() => window.matchMedia(desktopWorkspaceQuery), []);
  const [isDesktop, setIsDesktop] = useState(mediaQuery.matches);

  useEffect(() => {
    const syncViewport = () => setIsDesktop(mediaQuery.matches);
    mediaQuery.addEventListener("change", syncViewport);
    return () => mediaQuery.removeEventListener("change", syncViewport);
  }, [mediaQuery]);

  return isDesktop;
};
