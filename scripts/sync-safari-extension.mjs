import { access, cp, readFile, rm, writeFile } from "node:fs/promises";
import {
  applyMarketingVersion,
  findMissingArtifacts,
  findSafariManifestProblems,
  requiredSafariArtifacts,
} from "./safari-distribution.mjs";

const repoRoot = new URL("../", import.meta.url);
const buildDir = new URL("dist/extension-safari/", repoRoot);
const resourcesDir = new URL("apps/safari/Unquote Extension/Resources/", repoRoot);
const projectFile = new URL("apps/safari/Unquote.xcodeproj/project.pbxproj", repoRoot);

const buildHint = "Run `pnpm --filter @unquote/extension build:safari` first.";

const readManifest = async () => {
  try {
    return JSON.parse(await readFile(new URL("manifest.json", buildDir), "utf8"));
  } catch {
    throw new Error(`Missing or unreadable dist/extension-safari/manifest.json. ${buildHint}`);
  }
};

const listPresentArtifacts = async (directory) => {
  const present = [];
  for (const artifact of requiredSafariArtifacts) {
    try {
      await access(new URL(artifact, directory));
      present.push(artifact);
    } catch {}
  }

  return present;
};

const manifest = await readManifest();

const missing = findMissingArtifacts(await listPresentArtifacts(buildDir));
if (missing.length > 0) {
  throw new Error(`dist/extension-safari is incomplete: ${missing.join(", ")}. ${buildHint}`);
}

const problems = findSafariManifestProblems(manifest);
if (problems.length > 0) {
  throw new Error(
    `dist/extension-safari/manifest.json is not a Safari build:\n  - ${problems.join("\n  - ")}`,
  );
}

// MARKETING_VERSION is derived from the extension manifest, so the App Store
// release never drifts from the version the extension reports.
const project = await readFile(projectFile, "utf8");
const { project: syncedProject, replacements } = applyMarketingVersion(project, manifest.version);
if (syncedProject !== project) {
  await writeFile(projectFile, syncedProject);
}

await rm(resourcesDir, { recursive: true, force: true });
await cp(buildDir, resourcesDir, { recursive: true });

// The Xcode target reads this directory directly, so a partial copy has to
// fail here rather than at App Review.
const unsynced = findMissingArtifacts(await listPresentArtifacts(resourcesDir));
if (unsynced.length > 0) {
  throw new Error(`Safari extension resources are incomplete after sync: ${unsynced.join(", ")}`);
}

console.log(
  `Synced Unquote ${manifest.version} into the Safari extension target (${replacements} MARKETING_VERSION assignments).`,
);
