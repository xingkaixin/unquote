// Translation without the React app. The root barrel starts with
// `export * from "./app"`, so importing a translator from there drags React,
// Base UI, sonner, and the parser into the graph — fatal for the extension
// background, which only formats a handful of strings.
export { createTranslator, detectLocale, persistLocale } from "./i18n";
export type { Locale, MessageKey, Messages } from "./i18n";
export { en } from "./en";
export { zhCN } from "./zh-CN";
