import { en } from "./en";
import type { Messages, MessageKey } from "./en";
import { ja } from "./ja";
import { zhCN } from "./zh-CN";

export type { Messages, MessageKey };

const STORAGE_KEY = "unquote-locale";

export const localeRegistry = {
  en: {
    label: "locale.english",
    languagePrefixes: ["en"],
    messages: en,
  },
  "zh-CN": {
    label: "locale.chinese",
    languagePrefixes: ["zh"],
    messages: zhCN,
  },
  ja: {
    label: "locale.japanese",
    languagePrefixes: ["ja"],
    messages: ja,
  },
} as const satisfies Record<
  string,
  { label: MessageKey; languagePrefixes: readonly string[]; messages: Messages }
>;

export type Locale = keyof typeof localeRegistry;

const keysOf = <T extends object>(value: T) => Object.keys(value) as Array<keyof T>;

export const supportedLocales = Object.freeze(keysOf(localeRegistry));
const defaultLocale: Locale = "en";

const isLocale = (value: string): value is Locale => Object.hasOwn(localeRegistry, value);

export const detectLocale = (): Locale => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && isLocale(stored)) {
      return stored;
    }
  } catch {}

  const browserLanguage = navigator.language;
  return (
    supportedLocales.find((locale) =>
      localeRegistry[locale].languagePrefixes.some((prefix) => browserLanguage.startsWith(prefix)),
    ) ?? defaultLocale
  );
};

export const persistLocale = (locale: Locale) => {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {}
};

export const createTranslator =
  (messages: Messages) =>
  (key: MessageKey, params?: Record<string, string | number>): string => {
    let result = messages[key];
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        result = result.replace(`{${k}}`, String(v));
      }
    }
    return result;
  };
