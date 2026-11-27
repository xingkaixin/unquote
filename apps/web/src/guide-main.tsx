import React, { useLayoutEffect, useRef, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { I18nProvider, UnquoteApp } from "@unquote/ui";
import { initializeThemePreference } from "@unquote/ui/theme-preference";
import "@unquote/ui/styles.css";
import { changelogPaths } from "./changelog-routes";
import { guideRuntimeMeta } from "./guide-meta";
import { clearLegacySourceHash } from "./legacy-source-hash";
import {
  CHROME_WEB_STORE_URL,
  EDGE_ADDONS_URL,
  isGuideLocale,
  isGuideSlug,
  type GuideLocale,
  type GuideSlug,
} from "./site-links";
import { trackAnalyticsEvent } from "./telemetry";

initializeThemePreference();

clearLegacySourceHash(window.location, window.history);

const rootElement = document.getElementById("root")!;

const rawSlug = document.documentElement.dataset.guide ?? "";

const rawLocale = document.documentElement.dataset.guideLocale ?? "en";

const slug: GuideSlug = isGuideSlug(rawSlug) ? rawSlug : "jsonl-viewer";

const pageLocale: GuideLocale = isGuideLocale(rawLocale) ? rawLocale : "en";

const meta = guideRuntimeMeta[slug];

// Adopt the build-time pre-rendered hero and guide body so landing pages stay
// interactive above the fold without shipping localized prose in the JS bundle.
const adoptElement = (selector: string): HTMLElement | null => {
  const node = rootElement.querySelector<HTMLElement>(selector);
  if (!node) {
    return null;
  }
  node.remove();
  return node;
};

const adoptedHeader = adoptElement("[data-guide-header]");

const adoptedBody = adoptElement("[data-guide-body]");

const AdoptedSlot = ({ node }: { node: HTMLElement | null }) => {
  const hostRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !node) {
      return;
    }
    host.appendChild(node);
    return () => {
      if (node.parentNode === host) {
        host.removeChild(node);
      }
    };
  }, [node]);

  return node ? <div ref={hostRef} /> : null;
};

interface GuideWelcomeProps {
  controls: ReactNode;
  trySampleLabel: string;
  onTrySample?: (() => void) | undefined;
}

const GuideWelcome = ({ controls, trySampleLabel, onTrySample }: GuideWelcomeProps) => (
  <div className="uq-import-empty flex min-h-0 flex-1 justify-center overflow-y-auto px-6 py-10">
    <div className="my-auto flex w-full max-w-[660px] flex-col gap-6">
      <AdoptedSlot node={adoptedHeader} />
      <div className="flex flex-col gap-2">
        {controls}
        {onTrySample ? (
          <div>
            <button
              type="button"
              onClick={onTrySample}
              className="rounded-sm py-1 text-sm font-medium text-text-primary underline underline-offset-2 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {trySampleLabel}
            </button>
          </div>
        ) : null}
      </div>
      <AdoptedSlot node={adoptedBody} />
    </div>
  </div>
);

const GuideApp = () => (
  <UnquoteApp
    initialMode={meta.defaultMode}
    changelogUrls={changelogPaths}
    chromeWebStoreUrl={CHROME_WEB_STORE_URL}
    edgeAddonsUrl={EDGE_ADDONS_URL}
    onAnalyticsEvent={(event) => trackAnalyticsEvent(event, `${pageLocale}:${slug}`)}
    renderWelcome={(controls, onSelectSample, samples) => {
      const featured = samples.find((sample) => sample.id === meta.sampleId);
      return (
        <GuideWelcome
          controls={controls}
          trySampleLabel={meta.trySampleLabel[pageLocale]}
          onTrySample={featured ? () => onSelectSample(featured) : undefined}
        />
      );
    }}
  />
);

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <I18nProvider initialLocale={pageLocale}>
      <GuideApp />
    </I18nProvider>
  </React.StrictMode>,
);
