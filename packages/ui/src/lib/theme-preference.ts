export type Theme = "system" | "light" | "dark";

export const themeStorageKey = "unquote-theme";
export const themeMediaQuery = "(prefers-color-scheme: dark)";

const themeColors = {
  light: "#f4f5f6",
  dark: "#0d0f11",
} as const;

const isTheme = (value: string | null): value is Theme =>
  value === "system" || value === "light" || value === "dark";

export const readThemePreference = (): Theme => {
  try {
    const storedTheme = localStorage.getItem(themeStorageKey);
    return isTheme(storedTheme) ? storedTheme : "system";
  } catch {
    return "system";
  }
};

export const applyThemePreference = (theme: Theme, systemIsDark?: boolean) => {
  const isDark = theme === "dark" || (theme === "system" && systemIsDark === true);
  const colorScheme = isDark ? "dark" : "light";
  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.style.colorScheme = colorScheme;
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", themeColors[colorScheme]);
};

export const initializeThemePreference = () => {
  const theme = readThemePreference();
  const systemIsDark = theme === "system" && window.matchMedia(themeMediaQuery).matches;
  applyThemePreference(theme, systemIsDark);
};
