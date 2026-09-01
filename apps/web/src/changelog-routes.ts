import type { Locale } from "@unquote/ui";

export const changelogPaths = {
  en: "/changelog/",
  "zh-CN": "/zh-CN/changelog/",
  ja: "/ja/changelog/",
} as const satisfies Readonly<Record<Locale, string>>;

export const changelogLocales: readonly Locale[] = Object.keys(changelogPaths) as Locale[];

export const isChangelogLocale = (value: string): value is Locale =>
  Object.hasOwn(changelogPaths, value);
