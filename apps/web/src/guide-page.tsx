import { renderToStaticMarkup } from "react-dom/server";
import { guides } from "./guide-content.tsx";
import {
  CHROME_WEB_STORE_URL,
  EDGE_ADDONS_URL,
  GITHUB_URL,
  SITE_ORIGIN,
  guideLocales,
  guidePath,
  guideSlugs,
  isGuideLocale,
  isGuideSlug,
  type GuideLocale,
  type GuideSlug,
} from "./site-links.ts";

const chromeCopy = {
  en: {
    brand: "Unquote",
    guideCrumb: "Guide",
    otherLocaleLabel: "中文",
    changelogLabel: "Product updates",
    changelogHref: "/changelog/",
    openViewerLabel: "Open full viewer",
    enableJavaScript:
      "Enable JavaScript to paste JSON, JSONL, or SSE, drop local files, and inspect records directly on this page.",
    faqHeading: "Frequently asked questions",
    extensionHeading: "Inspect JSON directly in Chrome or Edge",
    extensionSummary:
      "Install the Unquote browser extension to open JSON responses, local files, or selected text in the same local viewer with one click.",
    chromeLabel: "Install Chrome Extension",
    edgeLabel: "Install Edge Extension",
    relatedTitle: "More guides & tools",
    footerPrivacy: "JSON, JSONL, and SSE contents stay in your browser.",
    sourceLabel: "View source on GitHub",
    ogLocale: "en_US",
    ogLocaleAlternate: "zh_CN",
  },
  "zh-CN": {
    brand: "Unquote",
    guideCrumb: "使用指南",
    otherLocaleLabel: "English",
    changelogLabel: "更新日志",
    changelogHref: "/zh-CN/changelog/",
    openViewerLabel: "打开完整查看器",
    enableJavaScript:
      "启用 JavaScript 后，即可在本页直接粘贴 JSON、JSONL 或 SSE、拖入本地文件并使用交互式查看器。",
    faqHeading: "常见问题",
    extensionHeading: "在 Chrome 或 Edge 中一键打开",
    extensionSummary:
      "安装 Unquote 浏览器扩展，直接在浏览器里打开接口 JSON 响应、本地文件或网页选中文本，同样完全本地解析。",
    chromeLabel: "安装 Chrome 扩展",
    edgeLabel: "安装 Edge 扩展",
    relatedTitle: "更多工具与指南",
    footerPrivacy: "JSON、JSONL 与 SSE 内容全部在本地浏览器中处理。",
    sourceLabel: "在 GitHub 查看源码",
    ogLocale: "zh_CN",
    ogLocaleAlternate: "en_US",
  },
} as const satisfies Record<GuideLocale, Record<string, string>>;

export const renderGuidePage = (slugInput: string, localeInput: string = "en") => {
  if (!isGuideSlug(slugInput)) {
    throw new Error(`Unsupported guide: ${slugInput}`);
  }
  if (!isGuideLocale(localeInput)) {
    throw new Error(`Unsupported guide locale: ${localeInput}`);
  }

  const slug: GuideSlug = slugInput;
  const locale: GuideLocale = localeInput;
  const otherLocale: GuideLocale = locale === "en" ? "zh-CN" : "en";
  const guide = guides[slug][locale];
  const ui = chromeCopy[locale];
  const url = `${SITE_ORIGIN}${guidePath(slug, locale)}`;
  const enUrl = `${SITE_ORIGIN}${guidePath(slug, "en")}`;
  const otherLocaleHref = guidePath(slug, otherLocale);

  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        name: guide.title,
        description: guide.description,
        url,
        inLanguage: locale,
        isPartOf: { "@type": "WebSite", name: "Unquote", url: `${SITE_ORIGIN}/` },
      },
      {
        "@type": "SoftwareApplication",
        name: "Unquote",
        url: `${SITE_ORIGIN}/`,
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Web, Chrome, Edge, Safari",
        isAccessibleForFree: true,
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
        },
        sameAs: [CHROME_WEB_STORE_URL, EDGE_ADDONS_URL, GITHUB_URL],
      },
      {
        "@type": "FAQPage",
        inLanguage: locale,
        mainEntity: guide.faqs.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: item.answer,
          },
        })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Unquote", item: `${SITE_ORIGIN}/` },
          { "@type": "ListItem", position: 2, name: guide.heading, item: url },
        ],
      },
    ],
  };

  return `<!doctype html>${renderToStaticMarkup(
    <html lang={locale} data-guide={slug} data-guide-locale={locale}>
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{guide.title}</title>
        <meta name="description" content={guide.description} />
        <meta
          name="robots"
          content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1"
        />
        <meta name="theme-color" content="#f4f5f6" />
        <meta name="color-scheme" content="light dark" />
        <link rel="canonical" href={url} />
        {guideLocales.map((altLocale) => (
          <link
            key={altLocale}
            rel="alternate"
            hrefLang={altLocale}
            href={`${SITE_ORIGIN}${guidePath(slug, altLocale)}`}
          />
        ))}
        <link rel="alternate" hrefLang="x-default" href={enUrl} />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Unquote" />
        <meta property="og:locale" content={ui.ogLocale} />
        <meta property="og:locale:alternate" content={ui.ogLocaleAlternate} />
        <meta property="og:url" content={url} />
        <meta property="og:title" content={guide.title} />
        <meta property="og:description" content={guide.description} />
        <meta property="og:image" content={`${SITE_ORIGIN}/og-image.png`} />
        <meta property="og:image:alt" content="Unquote JSON, JSONL, and SSE viewer" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={guide.title} />
        <meta name="twitter:description" content={guide.description} />
        <meta name="twitter:image" content={`${SITE_ORIGIN}/og-image.png`} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }}
        />
      </head>
      <body>
        <div id="root">
          <main className="uq-shell">
            <div className="uq-import-empty flex min-h-0 flex-1 justify-center overflow-y-auto px-6 py-10">
              <div className="my-auto flex w-full max-w-[660px] flex-col gap-6">
                <header data-guide-header="true" className="flex flex-col gap-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-secondary">
                    <nav aria-label="Breadcrumb" className="flex items-center gap-2 font-mono">
                      <a
                        href="/"
                        data-umami-event="open-viewer"
                        data-umami-event-guide={slug}
                        className="text-accent hover:underline"
                      >
                        {ui.brand}
                      </a>
                      <span aria-hidden="true">/</span>
                      <span>{ui.guideCrumb}</span>
                    </nav>
                    <div className="flex items-center gap-3">
                      <a
                        href={ui.changelogHref}
                        className="text-text-secondary hover:text-accent hover:underline"
                      >
                        {ui.changelogLabel}
                      </a>
                      <a
                        href={otherLocaleHref}
                        hrefLang={otherLocale}
                        className="text-text-secondary hover:text-accent hover:underline"
                      >
                        {ui.otherLocaleLabel}
                      </a>
                    </div>
                  </div>
                  <h1 className="m-0 text-[28px] font-semibold tracking-[-0.02em] text-text-primary">
                    {guide.heading}
                  </h1>
                  <p className="m-0 text-[14px] leading-[23px] text-text-secondary">
                    {guide.summary}
                  </p>
                </header>

                <p className="m-0 rounded-md border border-border bg-surface-100 p-4 text-sm text-text-secondary">
                  {ui.enableJavaScript}{" "}
                  <a
                    href="/"
                    data-umami-event="open-viewer"
                    data-umami-event-guide={slug}
                    className="font-medium text-text-primary underline underline-offset-2 hover:text-accent"
                  >
                    {ui.openViewerLabel}
                  </a>
                </p>

                <div data-guide-body="true" className="flex flex-col gap-6">
                  <article className="flex flex-col gap-6">
                    {guide.content}
                    <section className="flex flex-col gap-4 border-t border-border pt-6">
                      <h2 className="m-0 text-[16px] font-semibold text-text-primary">
                        {ui.faqHeading}
                      </h2>
                      <dl className="m-0 flex flex-col gap-4 text-sm leading-[23px]">
                        {guide.faqs.map((item) => (
                          <div key={item.question}>
                            <dt className="font-semibold text-text-primary">{item.question}</dt>
                            <dd className="m-0 mt-1 text-text-secondary">{item.answer}</dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  </article>

                  <section className="flex flex-col gap-2.5 rounded-md border border-border bg-surface-100 p-4 text-sm leading-[23px]">
                    <h2 className="m-0 text-[15px] font-semibold text-text-primary">
                      {ui.extensionHeading}
                    </h2>
                    <p className="m-0 text-text-secondary">{ui.extensionSummary}</p>
                    <div className="flex flex-wrap gap-4 pt-1">
                      <a
                        href={CHROME_WEB_STORE_URL}
                        target="_blank"
                        rel="noreferrer"
                        data-umami-event="install-extension"
                        data-umami-event-store="chrome"
                        data-umami-event-source={`guide:${slug}`}
                        className="font-medium text-text-primary underline underline-offset-2 hover:text-accent"
                      >
                        {ui.chromeLabel}
                      </a>
                      <a
                        href={EDGE_ADDONS_URL}
                        target="_blank"
                        rel="noreferrer"
                        data-umami-event="install-extension"
                        data-umami-event-store="edge"
                        data-umami-event-source={`guide:${slug}`}
                        className="font-medium text-text-primary underline underline-offset-2 hover:text-accent"
                      >
                        {ui.edgeLabel}
                      </a>
                    </div>
                  </section>

                  <nav
                    aria-label={ui.relatedTitle}
                    className="border-t border-border pt-4 text-sm leading-[23px]"
                  >
                    <h2 className="m-0 text-[16px] font-semibold text-text-primary">
                      {ui.relatedTitle}
                    </h2>
                    <ul className="m-0 mt-2 flex list-none flex-wrap gap-4 p-0">
                      {guideSlugs
                        .filter((relatedSlug) => relatedSlug !== slug)
                        .map((relatedSlug) => (
                          <li key={relatedSlug}>
                            <a
                              href={guidePath(relatedSlug, locale)}
                              hrefLang={locale}
                              className="text-text-secondary underline underline-offset-2 hover:text-accent"
                            >
                              {guides[relatedSlug][locale].heading}
                            </a>
                          </li>
                        ))}
                    </ul>
                  </nav>

                  <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4 text-xs text-text-secondary">
                    <p className="m-0">{ui.footerPrivacy}</p>
                    <a href={GITHUB_URL} className="hover:text-accent hover:underline">
                      {ui.sourceLabel}
                    </a>
                  </footer>
                </div>
              </div>
            </div>
          </main>
        </div>
        <script type="module" src="/src/guide-main.tsx" />
      </body>
    </html>,
  )}`;
};
