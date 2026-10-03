import { renderToStaticMarkup } from "react-dom/server";
import { guides } from "./guide-content.tsx";

const origin = "https://unquote.xingkaixin.me";

export const renderGuidePage = (slug: string) => {
  const guide = Object.entries(guides).find(([key]) => key === slug)?.[1];
  if (!guide) throw new Error(`Unsupported guide: ${slug}`);
  const url = `${origin}/${slug}/`;
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        name: guide.title,
        description: guide.description,
        url,
        inLanguage: "en",
        isPartOf: { "@type": "WebSite", name: "Unquote", url: `${origin}/` },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Unquote", item: `${origin}/` },
          { "@type": "ListItem", position: 2, name: guide.heading, item: url },
        ],
      },
    ],
  };

  return `<!doctype html>${renderToStaticMarkup(
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{guide.title}</title>
        <meta name="description" content={guide.description} />
        <meta name="robots" content="index, follow, max-image-preview:large" />
        <meta name="color-scheme" content="light dark" />
        <link rel="canonical" href={url} />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="stylesheet" href="/src/guide.css" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Unquote" />
        <meta property="og:locale" content="en_US" />
        <meta property="og:url" content={url} />
        <meta property="og:title" content={guide.title} />
        <meta property="og:description" content={guide.description} />
        <meta property="og:image" content={`${origin}/og-image.png`} />
        <meta property="og:image:alt" content="Unquote JSON and JSONL viewer" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta name="twitter:card" content="summary_large_image" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }}
        />
      </head>
      <body>
        <a className="skip-link" href="#main-content">
          Skip to guide
        </a>
        <header className="site-header">
          <div className="header-inner">
            <a className="brand" href="/" aria-label="Unquote home">
              <img src="/favicon.svg" width="26" height="26" alt="" />
              <span>UNQUOTE</span>
            </a>
            <nav aria-label="Primary navigation">
              <a className="nav-link" href="/changelog/">
                Product updates
              </a>
              <a
                className="primary-link"
                href="/"
                data-umami-event="open-viewer"
                data-umami-event-guide={slug}
              >
                Open viewer
              </a>
            </nav>
          </div>
        </header>
        <main id="main-content" className="guide-main">
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            <a href="/">Unquote</a>
            <span aria-hidden="true">/</span>
            <span>Guide</span>
          </nav>
          <article>
            <header className="guide-intro">
              <h1>{guide.heading}</h1>
              <p className="hero-summary">{guide.summary}</p>
              <a
                className="primary-link"
                href="/"
                data-umami-event="open-viewer"
                data-umami-event-guide={slug}
              >
                Open the free viewer
              </a>
            </header>
            <div className="guide-content">{guide.content}</div>
          </article>
          <aside className="related-guides" aria-labelledby="related-title">
            <h2 id="related-title">Related guides</h2>
            <ul>
              {Object.entries(guides)
                .filter(([key]) => key !== slug)
                .map(([key, related]) => (
                  <li key={key}>
                    <a href={`/${key}/`}>{related.heading}</a>
                  </li>
                ))}
            </ul>
          </aside>
        </main>
        <footer className="site-footer">
          <div className="footer-inner">
            <p>JSON and JSONL file contents stay in your browser.</p>
            <a href="https://github.com/xingkaixin/unquote">View source on GitHub</a>
          </div>
        </footer>
      </body>
    </html>,
  )}`;
};
