export type SourceRevision = number;

export interface SourceRevisionOwned {
  sourceRevision: SourceRevision;
}

export const belongsToSourceRevision = (
  sourceRevision: SourceRevision,
  value: SourceRevisionOwned,
) => value.sourceRevision === sourceRevision;

export const shareSourceRevision = (
  sourceRevision: SourceRevision,
  ...values: SourceRevisionOwned[]
) => values.every((value) => belongsToSourceRevision(sourceRevision, value));
