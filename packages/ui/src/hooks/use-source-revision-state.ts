import { useCallback, useMemo, useState } from "react";
import {
  createSourceRevisionState,
  readSourceRevisionState,
  replaceSourceRevisionState,
  updateSourceRevisionState,
} from "../lib/source-revision";
import type { SourceRevision, SourceRevisionUpdater } from "../lib/source-revision";

export const useSourceRevisionState = <Value>(
  sourceRevision: SourceRevision,
  createInitialValue: () => Value,
) => {
  const initialValue = useMemo(createInitialValue, [createInitialValue, sourceRevision]);
  const [storedState, setStoredState] = useState(() =>
    createSourceRevisionState(sourceRevision, initialValue),
  );
  const value = readSourceRevisionState(sourceRevision, storedState, initialValue);

  const update = useCallback(
    (updater: SourceRevisionUpdater<Value>) => {
      setStoredState((current) =>
        updateSourceRevisionState(current, sourceRevision, initialValue, updater),
      );
    },
    [initialValue, sourceRevision],
  );

  const replaceForRevision = useCallback((revision: SourceRevision, nextValue: Value) => {
    setStoredState((current) => replaceSourceRevisionState(current, revision, nextValue));
  }, []);

  return [value, update, replaceForRevision] as const;
};
