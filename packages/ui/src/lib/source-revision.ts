export type SourceRevision = number;

export interface SourceRevisionOwned {
  sourceRevision: SourceRevision;
}

export interface SourceRevisionState<Value> extends SourceRevisionOwned {
  value: Value;
}

export type SourceRevisionUpdater<Value> = (current: Value) => Value;

export const belongsToSourceRevision = (
  sourceRevision: SourceRevision,
  value: SourceRevisionOwned,
) => value.sourceRevision === sourceRevision;

export const shareSourceRevision = (
  sourceRevision: SourceRevision,
  ...values: SourceRevisionOwned[]
) => values.every((value) => belongsToSourceRevision(sourceRevision, value));

export const createSourceRevisionState = <Value>(
  sourceRevision: SourceRevision,
  value: Value,
): SourceRevisionState<Value> => ({ sourceRevision, value });

export const readSourceRevisionState = <Value>(
  sourceRevision: SourceRevision,
  state: SourceRevisionState<Value>,
  initialValue: Value,
) => (belongsToSourceRevision(sourceRevision, state) ? state.value : initialValue);

export const updateSourceRevisionState = <Value>(
  current: SourceRevisionState<Value>,
  sourceRevision: SourceRevision,
  initialValue: Value,
  updater: SourceRevisionUpdater<Value>,
): SourceRevisionState<Value> => {
  if (current.sourceRevision > sourceRevision) {
    return current;
  }

  const ownsCurrentValue = belongsToSourceRevision(sourceRevision, current);
  const currentValue = ownsCurrentValue ? current.value : initialValue;
  const nextValue = updater(currentValue);
  return ownsCurrentValue && Object.is(currentValue, nextValue)
    ? current
    : createSourceRevisionState(sourceRevision, nextValue);
};

export const replaceSourceRevisionState = <Value>(
  current: SourceRevisionState<Value>,
  sourceRevision: SourceRevision,
  value: Value,
) =>
  current.sourceRevision > sourceRevision
    ? current
    : createSourceRevisionState(sourceRevision, value);

export const commitSourceRevisionResult = <Result extends SourceRevisionOwned>(
  current: Result,
  result: Result,
) => (current.sourceRevision > result.sourceRevision ? current : result);
