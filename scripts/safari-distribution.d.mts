export declare const requiredSafariArtifacts: readonly string[];

export declare const applyMarketingVersion: (
  project: string,
  version: string,
) => { project: string; replacements: number };

export declare const findSafariManifestProblems: (manifest: unknown) => string[];

export declare const findMissingArtifacts: (presentFiles: readonly string[]) => string[];
