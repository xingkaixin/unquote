export const SITE_ORIGIN = "https://unquote.xingkaixin.me";

export const CHROME_WEB_STORE_URL =
  "https://chromewebstore.google.com/detail/unquote/ohcepfneflaihakpkkgmnbdgjhnmcjeg";

export const EDGE_ADDONS_URL =
  "https://microsoftedge.microsoft.com/addons/detail/amdbhljchamjbhknbamkcemccmelegdp";

export const GITHUB_URL = "https://github.com/xingkaixin/unquote";

export const guideSlugs = [
  "jsonl-viewer",
  "json-unescape",
  "agent-log-viewer",
  "sse-viewer",
] as const;

export type GuideSlug = (typeof guideSlugs)[number];

export const guideLocales = ["en", "zh-CN"] as const;

export type GuideLocale = (typeof guideLocales)[number];

export const isGuideSlug = (value: string): value is GuideSlug =>
  guideSlugs.some((slug) => slug === value);

export const isGuideLocale = (value: string): value is GuideLocale =>
  guideLocales.some((locale) => locale === value);

export const guidePath = (slug: GuideSlug, locale: GuideLocale = "en") =>
  locale === "en" ? `/${slug}/` : `/${locale}/${slug}/`;
