import { useEffect, useState } from "react";
import {
  applyThemePreference,
  readThemePreference,
  themeMediaQuery,
  themeStorageKey,
  type Theme,
} from "../lib/theme-preference";

export const useThemePreference = () => {
  const [theme, setTheme] = useState<Theme>(readThemePreference);

  useEffect(() => {
    try {
      localStorage.setItem(themeStorageKey, theme);
    } catch {
      // Theme application must continue when persistence is unavailable.
    }
    if (theme !== "system") {
      applyThemePreference(theme);
      return;
    }

    const mediaQuery = window.matchMedia(themeMediaQuery);
    const applySystemTheme = (event: MediaQueryListEvent | MediaQueryList) => {
      applyThemePreference("system", event.matches);
    };
    applySystemTheme(mediaQuery);
    mediaQuery.addEventListener("change", applySystemTheme);
    return () => mediaQuery.removeEventListener("change", applySystemTheme);
  }, [theme]);

  return { theme, setTheme };
};
