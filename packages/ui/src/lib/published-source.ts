import type { LocalFileAccess } from "./local-file-source";
import type { SourceMode } from "./source-candidate";
import type { SourceRevision } from "./source-revision";

const publishedSourceBrand: unique symbol = Symbol("published-source");
const sourceWorkBrand: unique symbol = Symbol("source-work");

export type SourceWorkProjection =
  | {
      readonly kind: "memory";
      readonly sourceRevision: SourceRevision;
      readonly text: string;
      readonly forcedFormat: "json" | "jsonl" | undefined;
      readonly [sourceWorkBrand]: true;
    }
  | {
      readonly kind: "local-file";
      readonly sourceRevision: SourceRevision;
      readonly access: LocalFileAccess;
      readonly [sourceWorkBrand]: true;
    };

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

interface PublishedSourceState {
  readonly work: SourceWorkProjection;
  readonly import: SourceImportProjection;
  readonly view: SourceViewProjection;
}

export interface PublishedSourceRevision {
  readonly sourceRevision: SourceRevision;
  readonly [publishedSourceBrand]: PublishedSourceState;
}

const freeze = <Value extends object>(value: Value): Readonly<Value> => Object.freeze(value);

const forcedFormatFor = (mode: SourceMode) => (mode === "auto" ? undefined : mode);

const createPublishedSource = (
  sourceRevision: SourceRevision,
  work: SourceWorkProjection,
  importProjection: SourceImportProjection,
  view: SourceViewProjection,
): PublishedSourceRevision =>
  freeze({
    sourceRevision,
    [publishedSourceBrand]: freeze({
      work: freeze(work),
      import: freeze(importProjection),
      view: freeze(view),
    }),
  });

export const createTextSourceRevision = (
  sourceRevision: SourceRevision,
  text: string,
  mode: SourceMode,
): PublishedSourceRevision =>
  createPublishedSource(
    sourceRevision,
    {
      kind: "memory",
      sourceRevision,
      text,
      forcedFormat: forcedFormatFor(mode),
      [sourceWorkBrand]: true,
    },
    { draft: text, file: null, mode },
    { hasData: text.trim().length > 0, file: null, streamedFileName: null },
  );

export const createImportedFileSourceRevision = (
  sourceRevision: SourceRevision,
  file: File,
  text: string,
  mode: SourceMode,
): PublishedSourceRevision =>
  createPublishedSource(
    sourceRevision,
    {
      kind: "memory",
      sourceRevision,
      text,
      forcedFormat: forcedFormatFor(mode),
      [sourceWorkBrand]: true,
    },
    { draft: text, file, mode },
    { hasData: true, file, streamedFileName: null },
  );

export const createStreamingFileSourceRevision = (
  sourceRevision: SourceRevision,
  access: LocalFileAccess,
  mode: Exclude<SourceMode, "json">,
): PublishedSourceRevision => {
  const file = access.getFile();
  return createPublishedSource(
    sourceRevision,
    {
      kind: "local-file",
      sourceRevision,
      access,
      [sourceWorkBrand]: true,
    },
    { draft: "", file, mode },
    { hasData: true, file, streamedFileName: access.name },
  );
};

export const projectSourceWork = (source: PublishedSourceRevision) =>
  source[publishedSourceBrand].work;

export const resolveSourceWork = (source: SourceWorkProjection): ResolvedSourceWork =>
  source.kind === "memory"
    ? {
        sourceRevision: source.sourceRevision,
        text: source.text,
        sourceAccess: null,
        forcedFormat: source.forcedFormat,
      }
    : {
        sourceRevision: source.sourceRevision,
        text: "",
        sourceAccess: source.access,
        forcedFormat: "jsonl",
      };

export const projectSourceImport = (source: PublishedSourceRevision) =>
  source[publishedSourceBrand].import;

export const projectSourceView = (source: PublishedSourceRevision) =>
  source[publishedSourceBrand].view;
