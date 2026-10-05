import { cp, mkdir, rm, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

const output = new URL(".cloudflare/output/v0/", root);

const worker = new URL("workers/default/", output);

// cf --prebuilt consumes Build Output v0 without installing a Cloudflare bundler.
await rm(output, { recursive: true, force: true });

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
    workersDev: true,
    domains: ["unquote.xingkaixin.me"],
    assets: {
      htmlHandling: "auto-trailing-slash",
      notFoundHandling: "404-page",
    },
  }),
);
