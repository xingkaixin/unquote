// Translation without the React app. The root barrel starts with
// `export * from "./app"`, so importing a translator from there drags React
// and UI shell modules into the graph — fatal for the extension
// background, which only formats a handful of strings.
export { createTranslator, detectLocale, persistLocale } from "./i18n";

export type { Locale, MessageKey, Messages } from "./i18n";

export { en } from "./en";

export { ja } from "./ja";

export { zhCN } from "./zh-CN";
