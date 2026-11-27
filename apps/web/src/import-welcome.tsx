import type { WelcomeCopy } from "./welcome-copy";
import type { ReactNode } from "react";
import type { createTranslator } from "@unquote/ui/i18n";
import { CHROME_WEB_STORE_URL, EDGE_ADDONS_URL, GITHUB_URL, guidePath } from "./site-links";

export const welcomeExample = {
  input: JSON.stringify({ body: JSON.stringify({ user: { id: 42 } }) }, null, 2),
  output: JSON.stringify({ body: { user: { id: 42 } } }, null, 2),
};

interface ImportWelcomeProps {
  copy: WelcomeCopy;
  t: ReturnType<typeof createTranslator>;
  children: ReactNode;
  onTryExample?: () => void;
}

export const ImportWelcome = ({ t, copy, children, onTryExample }: ImportWelcomeProps) => (
  <div className="uq-import-empty flex min-h-0 flex-1 justify-center overflow-y-auto px-6 py-10">
    <div className="my-auto flex w-full max-w-[660px] flex-col gap-6">
      <div className="flex flex-col gap-2.5">
        <span className="font-mono text-[11px] uppercase tracking-[var(--tracking-tag)] text-accent">
          Unquote
        </span>
        <h1 className="m-0 text-[28px] font-semibold tracking-[-0.02em] text-text-primary">
          {t("empty.headline")}
        </h1>
        <p className="m-0 text-[14px] leading-[23px] text-text-secondary">{t("empty.subtitle")}</p>
      </div>
      {children}
      <section aria-labelledby="example-title" className="border-t border-border pt-4">
        <h2 id="example-title" className="m-0 text-[16px] font-semibold text-text-primary">
          {copy.exampleTitle}
        </h2>
        <p className="mb-4 mt-2 text-sm leading-[23px] text-text-secondary">
          {copy.exampleDescription}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {(["input", "output"] as const).map((side) => (
            <figure key={side} className="m-0 min-w-0">
              <figcaption className="mb-2 text-xs font-medium text-text-secondary">
                {side === "input" ? copy.before : copy.after}
              </figcaption>
              <pre className="m-0 rounded-md border border-border bg-surface-100 p-3 font-mono text-xs leading-[23px] whitespace-pre-wrap break-all text-text-primary">
                <code>{welcomeExample[side]}</code>
              </pre>
            </figure>
          ))}
        </div>
        {onTryExample ? (
          <button
            type="button"
            onClick={onTryExample}
            className="mt-2 rounded-sm py-2 text-sm font-medium text-text-primary underline underline-offset-2 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {copy.tryExample}
          </button>
        ) : null}
      </section>
      <dl className="m-0 grid gap-4 text-sm leading-[23px]">
        {(["formatting", "jsonl", "sse", "local"] as const).map((topic) => (
          <div key={topic}>
            <dt className="font-semibold text-text-primary">{copy[`${topic}Title`]}</dt>
            <dd className="m-0 mt-1 text-text-secondary">{copy[`${topic}Description`]}</dd>
          </div>
        ))}
      </dl>
      <section aria-labelledby="faq-title" className="border-t border-border pt-4">
        <h2 id="faq-title" className="m-0 text-[16px] font-semibold text-text-primary">
          {copy.faqTitle}
        </h2>
        <dl className="m-0 mt-3 grid gap-4 text-sm leading-[23px]">
          {copy.faqs.map((item) => (
            <div key={item.question}>
              <dt className="font-semibold text-text-primary">{item.question}</dt>
              <dd className="m-0 mt-1 text-text-secondary">{item.answer}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section
        aria-labelledby="extensions-title"
        className="flex flex-col gap-2 rounded-md border border-border bg-surface-100 p-4 text-sm leading-[23px]"
      >
        <h2 id="extensions-title" className="m-0 text-[15px] font-semibold text-text-primary">
          {copy.extensionTitle}
        </h2>
        <p className="m-0 text-text-secondary">{copy.extensionDescription}</p>
        <div className="flex flex-wrap gap-4 pt-1">
          <a
            href={CHROME_WEB_STORE_URL}
            target="_blank"
            rel="noreferrer"
            data-umami-event="install-extension"
            data-umami-event-store="chrome"
            data-umami-event-source="welcome"
            className="font-medium text-text-primary underline underline-offset-2 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {copy.chromeLink}
          </a>
          <a
            href={EDGE_ADDONS_URL}
            target="_blank"
            rel="noreferrer"
            data-umami-event="install-extension"
            data-umami-event-store="edge"
            data-umami-event-source="welcome"
            className="font-medium text-text-primary underline underline-offset-2 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {copy.edgeLink}
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="text-text-secondary underline underline-offset-2 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {copy.githubLink}
          </a>
        </div>
      </section>
      <nav
        aria-label={copy.guidesTitle}
        className="border-t border-border pt-4 text-sm leading-[23px]"
      >
        <h2 className="m-0 text-[16px] font-semibold text-text-primary">{copy.guidesTitle}</h2>
        <ul className="m-0 mt-2 flex list-none flex-wrap gap-4 p-0">
          {(
            [
              ["jsonl-viewer", copy.jsonlGuide],
              ["json-unescape", copy.unescapeGuide],
              ["agent-log-viewer", copy.agentGuide],
              ["sse-viewer", copy.sseGuide],
            ] as const
          ).map(([slug, label]) => (
            <li key={slug}>
              <a
                href={guidePath(slug, copy.guidesLocale)}
                hrefLang={copy.guidesLocale}
                className="text-text-secondary underline underline-offset-2 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  </div>
);
