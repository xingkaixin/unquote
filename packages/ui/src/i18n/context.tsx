import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { en } from "./en";
import { zhCN } from "./zh-CN";
import { createTranslator, detectLocale, persistLocale } from "./i18n";
import type { Locale, MessageKey, Messages } from "./i18n";

const locales: Record<Locale, Messages> = { en, "zh-CN": zhCN };

interface I18nContextValue {
  locale: Locale;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export const I18nProvider = ({ children }: { children: ReactNode }) => {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  const value = useMemo<I18nContextValue>(() => {
    const t = createTranslator(locales[locale]);
    return {
      locale,
      t,
      setLocale: (next: Locale) => {
        persistLocale(next);
        setLocaleState(next);
      },
    };
  }, [locale]);

  return <I18nContext value={value}>{children}</I18nContext>;
};

export const useTranslation = () => {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useTranslation must be used within an I18nProvider");
  }
  return ctx;
};
