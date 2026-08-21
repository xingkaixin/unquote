import "wxt/browser";

declare module "wxt/browser" {
  interface WxtI18n {
    getMessage(messageName: "appName" | "appDescription" | "openInUnquote" | "openUnquote"): string;
  }
}
