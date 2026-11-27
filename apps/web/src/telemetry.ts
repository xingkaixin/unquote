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
    window.umami?.track?.(event.name, { ...event.data, page });
  } catch {
    // Analytics must never interrupt parsing or viewing workflows.
  }
};
