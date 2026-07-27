import { cp, readFile, rm, writeFile } from "node:fs/promises";

const repoRoot = new URL("../", import.meta.url);
const buildDir = new URL("dist/extension-safari/", repoRoot);
const resourcesDir = new URL("apps/safari/Unquote Extension/Resources/", repoRoot);
const projectFile = new URL("apps/safari/Unquote.xcodeproj/project.pbxproj", repoRoot);

const readManifest = async () => {
  try {
    return JSON.parse(await readFile(new URL("manifest.json", buildDir), "utf8"));
  } catch {
    throw new Error(
      "Missing dist/extension-safari. Run `pnpm --filter @unquote/extension build:safari` first.",
    );
  }
};

const manifest = await readManifest();

// MARKETING_VERSION is derived from the extension manifest, so the App Store
// release never drifts from the version the extension reports.
const project = await readFile(projectFile, "utf8");
const syncedProject = project.replaceAll(
  /MARKETING_VERSION = [^;]+;/g,
  `MARKETING_VERSION = ${manifest.version};`,
);
if (syncedProject !== project) {
  await writeFile(projectFile, syncedProject);
}

await rm(resourcesDir, { recursive: true, force: true });
await cp(buildDir, resourcesDir, { recursive: true });

console.log(`Synced Unquote ${manifest.version} into the Safari extension target.`);
