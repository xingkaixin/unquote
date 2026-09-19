import { renderToStaticMarkup } from "react-dom/server";
import { ImportWelcome } from "../../../packages/ui/src/components/import-welcome.tsx";
import { createTranslator, en } from "../../../packages/ui/src/i18n/index.ts";

export const renderHomepage = () => {
  const t = createTranslator(en);
  return renderToStaticMarkup(
    <main className="uq-shell">
      <ImportWelcome t={t}>
        <p className="rounded-md border border-border bg-surface-100 p-4 text-sm text-text-secondary">
          {t("welcome.enableJavaScript")}
        </p>
      </ImportWelcome>
    </main>,
  );
};
