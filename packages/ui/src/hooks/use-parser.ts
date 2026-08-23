import { useEffect, useEffectEvent, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "../i18n/context";
import { mightContainAgentSession } from "../lib/agent-session/probe";
import { isWithinMainThreadBudget } from "../lib/main-thread-budget";
import {
  createParserExecutor,
  parseInitialText,
  pendingParserSnapshot,
  type ParserSnapshot,
  type ParserStateUpdate,
} from "../lib/parser-executor";
import { resolveSourceWork } from "../lib/published-source";
import type { PublishedSourceRevision } from "../lib/published-source";
import { belongsToSourceRevision, commitSourceRevisionResult } from "../lib/source-revision";

export type { ParserSnapshot } from "../lib/parser-executor";

export interface UseParserOptions {
  source: PublishedSourceRevision;
  onAgentSessionDetected?: (() => void) | undefined;
}

export const useParser = ({ source, onAgentSessionDetected }: UseParserOptions) => {
  const { text: input, forcedFormat, sourceAccess, sourceRevision } = resolveSourceWork(source);
  const { t } = useTranslation();
  const [mountParse] = useState(() => {
    if (sourceAccess || !isWithinMainThreadBudget(input.length)) {
      return null;
    }
    return {
      sourceRevision,
      input,
      forcedFormat,
      parsed: parseInitialText(input, forcedFormat),
    };
  });
  const [parserState, setParserState] = useState<ParserSnapshot>(() =>
    mountParse
      ? { sourceRevision, ...mountParse.parsed, recordAppend: null }
      : pendingParserSnapshot(sourceRevision, forcedFormat, sourceAccess !== null),
  );
  const commitParserState = useEffectEvent((update: ParserStateUpdate) => {
    setParserState((current) =>
      commitSourceRevisionResult(current, typeof update === "function" ? update(current) : update),
    );
  });
  const reportFileReadError = useEffectEvent(() => {
    toast.error(t("input.readFailed"));
  });
  const reportInputTooLarge = useEffectEvent(() => {
    toast.error(t("input.tooLargeWithoutWorker"));
  });
  const reportAgentSessionDetected = useEffectEvent(() => {
    onAgentSessionDetected?.();
  });
  const [executor] = useState(createParserExecutor);

  useEffect(() => {
    const reuseInitialResult =
      mountParse?.sourceRevision === sourceRevision &&
      mountParse.input === input &&
      mountParse.forcedFormat === forcedFormat &&
      !sourceAccess;
    if (
      reuseInitialResult &&
      (mountParse.parsed.result.format !== "jsonl" || !mightContainAgentSession(input))
    ) {
      return;
    }

    return executor.run({
      sourceRevision,
      input,
      forcedFormat,
      sourceFile: sourceAccess?.getFile() ?? null,
      hasLocalFile: sourceAccess !== null,
      reuseInitialResult,
      commit: commitParserState,
      onReadError: reportFileReadError,
      onTooLarge: reportInputTooLarge,
      onAgentSessionDetected: reportAgentSessionDetected,
    });
  }, [executor, forcedFormat, input, mountParse, sourceAccess, sourceRevision]);

  useEffect(() => () => executor.dispose(), [executor]);

  return belongsToSourceRevision(sourceRevision, parserState)
    ? parserState
    : pendingParserSnapshot(sourceRevision, forcedFormat, sourceAccess !== null);
};
