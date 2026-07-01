import { useEffect, useState } from "react";

export type Theme = "system" | "light" | "dark";

export const useThemePreference = () => {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem("unquote-theme") as Theme) ?? "system";
    } catch {
      return "system";
    }
  });

  useEffect(() => {
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
    localStorage.setItem("unquote-theme", theme);
  }, [theme]);

  return { theme, setTheme };
};
