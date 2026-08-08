// Files the Xcode extension target loads directly. A sync that copies a
// half-built directory looks successful until App Review opens it.
export const requiredSafariArtifacts = [
  "manifest.json",
  "background.js",
  "options.html",
  "_locales/en/messages.json",
];

const marketingVersionPattern = /MARKETING_VERSION = [^;]+;/g;

/**
 * Rewrites every MARKETING_VERSION in the Xcode project. A zero-match rewrite
 * used to succeed silently and ship whatever version the project already had,
 * so a missing target is an error rather than a no-op.
 */
export const applyMarketingVersion = (project, version) => {
  const matches = project.match(marketingVersionPattern) ?? [];
  if (matches.length === 0) {
    throw new Error(
      "No MARKETING_VERSION assignment found in the Xcode project; the Safari release version cannot be synced.",
    );
  }

  return {
    project: project.replaceAll(marketingVersionPattern, `MARKETING_VERSION = ${version};`),
    replacements: matches.length,
  };
};

/**
 * The sync moves an already-built artifact; it must not re-derive product
 * policy. It only checks that what WXT produced is the Safari build it claims
 * to be.
 */
export const findSafariManifestProblems = (manifest) => {
  const problems = [];

  if (typeof manifest?.version !== "string" || manifest.version.length === 0) {
    problems.push("manifest.json has no version");
  }
  if (manifest?.manifest_version !== 3) {
    problems.push(
      `expected manifest_version 3, found ${JSON.stringify(manifest?.manifest_version)}`,
    );
  }
  if (manifest?.permissions?.includes("clipboardRead")) {
    problems.push("Safari does not support the clipboardRead permission");
  }
  for (const permission of ["alarms", "contextMenus", "storage"]) {
    if (!manifest?.permissions?.includes(permission)) {
      problems.push(`missing the ${permission} permission`);
    }
  }
  if (!manifest?.commands?.open_unquote) {
    problems.push("missing the open_unquote command");
  }
  if (manifest?.default_locale !== "en") {
    problems.push(
      `expected default_locale "en", found ${JSON.stringify(manifest?.default_locale)}`,
    );
  }

  return problems;
};

export const findMissingArtifacts = (presentFiles) =>
  requiredSafariArtifacts.filter((artifact) => !presentFiles.includes(artifact));
