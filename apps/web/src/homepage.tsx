import { welcomeCopy } from "./welcome-copy.ts";
import { renderToStaticMarkup } from "react-dom/server";
import { ImportWelcome } from "./import-welcome.tsx";
import { createTranslator, en } from "../../../packages/ui/src/i18n/index.ts";

export const renderHomepage = () => {
  const t = createTranslator(en);
  return renderToStaticMarkup(
    <main className="uq-shell">
      <ImportWelcome t={t} copy={welcomeCopy.en}>
        <p className="rounded-md border border-border bg-surface-100 p-4 text-sm text-text-secondary">
          {welcomeCopy.en.enableJavaScript}
        </p>
      </ImportWelcome>
    </main>,
  );
};
