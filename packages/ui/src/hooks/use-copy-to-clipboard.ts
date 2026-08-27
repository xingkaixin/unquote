import { useCallback, useLayoutEffect, useRef } from "react";
import { toast } from "sonner";
import { useTranslation } from "../i18n/context";
import { writeClipboardText } from "../lib/clipboard";
import { reportDiagnostic } from "../lib/diagnostics";
import { isCopyTextAboveThreshold } from "../lib/record-export";
import type { SourceRevision } from "../lib/source-revision";

// Returning null means the caller already handled its own failure, so no
// clipboard write should follow.
export type CopyTextProducer = (signal: AbortSignal) => string | null | Promise<string | null>;

/**
 * Arbitrates every clipboard write behind one monotonic generation, so only
 * the most recently requested copy of the current source can commit. Producing
 * the text can take a file read or a batch of record parses, during which a
 * newer copy, a source switch, or an unmount may have made this one obsolete;
 * the producer signal stops that obsolete work at its source.
 */
export const useCopyToClipboard = (sourceRevision: SourceRevision) => {
  const { t } = useTranslation();
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  useLayoutEffect(
    () => () => {
      generationRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
    },
    [sourceRevision],
  );

  return useCallback(
    async (produceText: CopyTextProducer) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const generation = (generationRef.current += 1);
      try {
        const text = await produceText(controller.signal);
        if (text === null || controller.signal.aborted || generation !== generationRef.current) {
          return;
        }
        if (isCopyTextAboveThreshold(text)) {
          toast.warning(t("toolbar.copyBlocked"));
          return;
        }

        if (!(await writeClipboardText(text))) {
          toast.error(t("copy.failed"));
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          reportDiagnostic("copy.build", error);
          toast.error(t("copy.failed"));
        }
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
        }
      }
    },
    [t],
  );
};
