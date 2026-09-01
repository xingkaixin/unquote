import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const budgets = {
  initialJsBytes: 620_000,
  initialJsGzipBytes: 205_000,
  totalJsBytes: 760_000,
  totalJsGzipBytes: 250_000,
  initialCssBytes: 38_000,
  initialCssGzipBytes: 9_000,
};

const staticPageBudgets = {
  cssBytes: 8_000,
  cssGzipBytes: 3_000,
};

const surfaces = [
  {
    name: "web",
    root: "dist/web",
    html: "dist/web/index.html",
    jsDirectory: "dist/web/assets",
    includeJs: (fileName) =>
      fileName.endsWith(".js") &&
      !fileName.includes("parser-worker-") &&
      !fileName.includes("search-worker-"),
  },
  {
    name: "extension",
    root: "dist/extension",
    html: "dist/extension/options.html",
    jsDirectory: "dist/extension/chunks",
    includeJs: (fileName) => fileName.endsWith(".js"),
  },
];

const staticPages = [
  {
    name: "web changelog en",
    root: "dist/web",
    html: "dist/web/changelog/index.html",
  },
  {
    name: "web changelog zh-CN",
    root: "dist/web",
    html: "dist/web/zh-CN/changelog/index.html",
  },
  {
    name: "web changelog ja",
    root: "dist/web",
    html: "dist/web/ja/changelog/index.html",
  },
];

const assetPathsFromHtml = (surface, extension) => {
  const html = readFileSync(surface.html, "utf8");
  const assets = new Set();
  const attributePattern = /(?:src|href)=(['"])([^'"]+)\1/g;
  for (const match of html.matchAll(attributePattern)) {
    const assetPath = match[2];
    if (assetPath?.endsWith(extension) && !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(assetPath)) {
      assets.add(path.join(surface.root, assetPath.replace(/^\//, "")));
    }
  }
  return [...assets];
};

const assetPathsFromDirectory = (directory, include) =>
  readdirSync(directory)
    .filter(include)
    .map((fileName) => path.join(directory, fileName));

const measure = (files) =>
  files.reduce(
    (total, file) => {
      const contents = readFileSync(file);
      total.bytes += contents.byteLength;
      total.gzipBytes += gzipSync(contents).byteLength;
      return total;
    },
    { bytes: 0, gzipBytes: 0 },
  );

const formatBytes = (bytes) => `${bytes} bytes (${(bytes / 1024).toFixed(1)} KiB)`;
const failures = [];

const checkBudget = (surfaceName, metric, actual, budget) => {
  if (actual > budget) {
    failures.push(`${surfaceName} ${metric} ${formatBytes(actual)} exceeds ${formatBytes(budget)}`);
  }
};

for (const surface of surfaces) {
  const initialJsFiles = assetPathsFromHtml(surface, ".js");
  const allJsFiles = assetPathsFromDirectory(surface.jsDirectory, surface.includeJs);
  const initialCssFiles = assetPathsFromHtml(surface, ".css");
  const initialJs = measure(initialJsFiles);
  const totalJs = measure(allJsFiles);
  const initialCss = measure(initialCssFiles);

  if (initialJsFiles.length === 0) {
    failures.push(`${surface.name} has no initial JavaScript assets`);
  }
  if (allJsFiles.length === 0) {
    failures.push(`${surface.name} has no UI JavaScript assets`);
  }
  if (initialCssFiles.length === 0) {
    failures.push(`${surface.name} has no initial CSS assets`);
  }

  console.log(
    `${surface.name}: initial JS ${formatBytes(initialJs.bytes)}, ${formatBytes(initialJs.gzipBytes)} gzipped; ` +
      `total UI JS ${formatBytes(totalJs.bytes)}, ${formatBytes(totalJs.gzipBytes)} gzipped; ` +
      `initial CSS ${formatBytes(initialCss.bytes)}, ${formatBytes(initialCss.gzipBytes)} gzipped`,
  );

  checkBudget(surface.name, "initial JS", initialJs.bytes, budgets.initialJsBytes);
  checkBudget(surface.name, "initial JS gzip", initialJs.gzipBytes, budgets.initialJsGzipBytes);
  checkBudget(surface.name, "total UI JS", totalJs.bytes, budgets.totalJsBytes);
  checkBudget(surface.name, "total UI JS gzip", totalJs.gzipBytes, budgets.totalJsGzipBytes);
  checkBudget(surface.name, "initial CSS", initialCss.bytes, budgets.initialCssBytes);
  checkBudget(surface.name, "initial CSS gzip", initialCss.gzipBytes, budgets.initialCssGzipBytes);
}

for (const page of staticPages) {
  const cssFiles = assetPathsFromHtml(page, ".css");
  const css = measure(cssFiles);

  if (cssFiles.length === 0) {
    failures.push(`${page.name} has no CSS assets`);
  }

  console.log(`${page.name}: CSS ${formatBytes(css.bytes)}, ${formatBytes(css.gzipBytes)} gzipped`);

  checkBudget(page.name, "CSS", css.bytes, staticPageBudgets.cssBytes);
  checkBudget(page.name, "CSS gzip", css.gzipBytes, staticPageBudgets.cssGzipBytes);
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `  - ${failure}`).join("\n"));
  process.exit(1);
}
