import "wxt/browser";

declare module "wxt/browser" {
  interface WxtRuntime {
    getURL(path: "/options.html"): string;
  }
}
