import type { ReactNode } from "react";
import type { createTranslator } from "../i18n/i18n";

export const welcomeExample = {
  input: JSON.stringify({ body: JSON.stringify({ user: { id: 42 } }) }, null, 2),
  output: JSON.stringify({ body: { user: { id: 42 } } }, null, 2),
};

interface ImportWelcomeProps {
  t: ReturnType<typeof createTranslator>;
  children: ReactNode;
  onTryExample?: () => void;
}

export const ImportWelcome = ({ t, children, onTryExample }: ImportWelcomeProps) => (
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
      <section aria-labelledby="example-title" className="border-t border-border pt-6">
        <h2 id="example-title" className="m-0 text-base font-semibold text-text-primary">
          {t("welcome.exampleTitle")}
        </h2>
        <p className="mb-4 mt-2 text-sm leading-relaxed text-text-secondary">
          {t("welcome.exampleDescription")}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {(["input", "output"] as const).map((side) => (
            <figure key={side} className="m-0 min-w-0">
              <figcaption className="mb-2 text-xs font-medium text-text-secondary">
                {t(side === "input" ? "welcome.before" : "welcome.after")}
              </figcaption>
              <pre className="m-0 rounded-md border border-border bg-surface-100 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all text-text-primary">
                <code>{welcomeExample[side]}</code>
              </pre>
            </figure>
          ))}
        </div>
        {onTryExample ? (
          <button
            type="button"
            onClick={onTryExample}
            className="mt-3 rounded-sm py-2 text-sm font-medium text-text-primary underline underline-offset-4 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {t("welcome.tryExample")}
          </button>
        ) : null}
      </section>
      <dl className="m-0 grid gap-4 text-sm leading-relaxed">
        {(["formatting", "jsonl", "local"] as const).map((topic) => (
          <div key={topic}>
            <dt className="font-semibold text-text-primary">{t(`welcome.${topic}Title`)}</dt>
            <dd className="m-0 mt-1 text-text-secondary">{t(`welcome.${topic}Description`)}</dd>
          </div>
        ))}
      </dl>
    </div>
  </div>
);
