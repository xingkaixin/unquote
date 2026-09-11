export declare const requiredSafariArtifacts: readonly string[];

export declare const applyMarketingVersion: (
  project: string,
  version: string,
) => { project: string; replacements: number };

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Manifest validation starts with unchecked JSON read from a generated file.
export declare const findSafariManifestProblems: (manifest: unknown) => string[];

export declare const findMissingArtifacts: (presentFiles: readonly string[]) => string[];
