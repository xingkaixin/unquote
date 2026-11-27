import type { UnquoteAnalyticsEvent } from "@unquote/ui";

declare global {
  interface Window {
    umami?: {
      track?: (name: string, data?: Record<string, string>) => void;
    };
  }
}

export const trackAnalyticsEvent = (event: UnquoteAnalyticsEvent, page: string) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (event.name === "parse-source" && event.data.input === "text") {
      const { input: _input, ...rest } = event.data;
      window.umami?.track?.("paste-json", { ...rest, page });
      return;
    }

    if (event.name === "sample-select") {
      window.umami?.track?.("load-sample", { ...event.data, page });
      return;
    }

    window.umami?.track?.(event.name, { ...event.data, page });
  } catch {
    // Analytics must never interrupt parsing or viewing workflows.
  }
};
