import { useEffect, useState } from "react";

export type Theme = "system" | "light" | "dark";

const themeStorageKey = "unquote-theme";

const isTheme = (value: string | null): value is Theme =>
  value === "system" || value === "light" || value === "dark";

const readThemePreference = (): Theme => {
  try {
    const storedTheme = localStorage.getItem(themeStorageKey);
    return isTheme(storedTheme) ? storedTheme : "system";
  } catch {
    return "system";
  }
};

export const useThemePreference = () => {
  const [theme, setTheme] = useState<Theme>(readThemePreference);

  useEffect(() => {
    try {
      localStorage.setItem(themeStorageKey, theme);
    } catch {
      // Theme application must continue when persistence is unavailable.
    }
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else if (theme === "light") {
      root.classList.remove("dark");
    } else {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const apply = (e: MediaQueryListEvent | MediaQueryList) => {
        root.classList.toggle("dark", e.matches);
      };
      apply(mq);
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [theme]);

  return { theme, setTheme };
};
