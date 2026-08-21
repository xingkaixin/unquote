import type { LocalFileAccess } from "./local-file-source";
import type { SourceMode } from "./source-candidate";
import type { SourceRevision } from "./source-revision";

interface PublishedMemorySource {
  readonly kind: "memory";
  readonly sourceRevision: SourceRevision;
  readonly text: string;
  readonly mode: SourceMode;
  readonly file: File | null;
}

interface PublishedLocalFileSource {
  readonly kind: "local-file";
  readonly sourceRevision: SourceRevision;
  readonly access: LocalFileAccess;
  readonly mode: Exclude<SourceMode, "json">;
}

export type PublishedSourceRevision = PublishedMemorySource | PublishedLocalFileSource;

export interface ResolvedSourceWork {
  readonly sourceRevision: SourceRevision;
  readonly text: string;
  readonly sourceAccess: LocalFileAccess | null;
  readonly forcedFormat: "json" | "jsonl" | undefined;
}

export interface SourceImportProjection {
  readonly draft: string;
  readonly file: File | null;
  readonly mode: SourceMode;
}

export interface SourceViewProjection {
  readonly hasData: boolean;
  readonly file: File | null;
  readonly streamedFileName: string | null;
}

const freeze = <Value extends object>(value: Value): Readonly<Value> => Object.freeze(value);

const forcedFormatFor = (mode: SourceMode) => (mode === "auto" ? undefined : mode);

export const createTextSourceRevision = (
  sourceRevision: SourceRevision,
  text: string,
  mode: SourceMode,
): PublishedSourceRevision =>
  freeze({
    kind: "memory",
    sourceRevision,
    text,
    mode,
    file: null,
  });

export const createImportedFileSourceRevision = (
  sourceRevision: SourceRevision,
  file: File,
  text: string,
  mode: SourceMode,
): PublishedSourceRevision =>
  freeze({
    kind: "memory",
    sourceRevision,
    text,
    mode,
    file,
  });

export const createStreamingFileSourceRevision = (
  sourceRevision: SourceRevision,
  access: LocalFileAccess,
  mode: Exclude<SourceMode, "json">,
): PublishedSourceRevision =>
  freeze({
    kind: "local-file",
    sourceRevision,
    access,
    mode,
  });

export const resolveSourceWork = (source: PublishedSourceRevision): ResolvedSourceWork =>
  source.kind === "memory"
    ? {
        sourceRevision: source.sourceRevision,
        text: source.text,
        sourceAccess: null,
        forcedFormat: forcedFormatFor(source.mode),
      }
    : {
        sourceRevision: source.sourceRevision,
        text: "",
        sourceAccess: source.access,
        forcedFormat: "jsonl",
      };

export const projectSourceImport = (source: PublishedSourceRevision): SourceImportProjection => ({
  draft: source.kind === "memory" ? source.text : "",
  file: source.kind === "memory" ? source.file : source.access.getFile(),
  mode: source.mode,
});

export const projectSourceView = (source: PublishedSourceRevision): SourceViewProjection => {
  if (source.kind === "local-file") {
    return {
      hasData: true,
      file: source.access.getFile(),
      streamedFileName: source.access.name,
    };
  }

  return {
    hasData: source.file !== null || source.text.trim().length > 0,
    file: source.file,
    streamedFileName: null,
  };
};
