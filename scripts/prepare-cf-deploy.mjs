import { cp, mkdir, rm, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

const outputRoot = new URL(".cloudflare/output/", root);

const output = new URL("v1/", outputRoot);

const worker = new URL("workers/default/", output);

// cf --prebuilt consumes Build Output v1 without installing a Cloudflare bundler.
// Clear the parent output directory so stale v0 artifacts cannot conflict with v1.
await rm(outputRoot, { recursive: true, force: true });

await mkdir(worker, { recursive: true });

await cp(new URL("dist/web/", root), new URL("assets/", worker), { recursive: true });

await writeFile(
  new URL("config.json", output),
  JSON.stringify({ buildContext: { isPreview: false } }),
);

await writeFile(
  new URL("worker.config.json", worker),
  JSON.stringify({
    name: "unquote",
    compatibilityDate: "2026-10-05",
    workersDev: false,
    previewUrls: false,
    domains: ["unquote.xingkaixin.me"],
    assets: {
      htmlHandling: "auto-trailing-slash",
      notFoundHandling: "404-page",
    },
  }),
);
