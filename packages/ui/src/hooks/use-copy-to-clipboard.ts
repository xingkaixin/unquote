import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useTranslation } from "../i18n/context";
import { writeClipboardText } from "../lib/clipboard";
import type { SourceRevision } from "../lib/source-revision";

// Returning null means the caller already handled its own failure, so no
// clipboard write should follow.
export type CopyTextProducer = () => string | null | Promise<string | null>;

/**
 * Arbitrates every clipboard write behind one monotonic generation, so only
 * the most recently requested copy of the current source can commit. Producing
 * the text can take a file read or a batch of record parses, during which a
 * newer copy, a source switch, or an unmount may have made this one obsolete.
 */
export const useCopyToClipboard = (sourceRevision: SourceRevision) => {
  const { t } = useTranslation();
  const generationRef = useRef(0);

  useEffect(() => () => void (generationRef.current += 1), [sourceRevision]);

  return useCallback(
    async (produceText: CopyTextProducer) => {
      const generation = (generationRef.current += 1);
      const text = await produceText();
      if (text === null || generation !== generationRef.current) {
        return;
      }

      if (!(await writeClipboardText(text))) {
        toast.error(t("copy.failed"));
      }
    },
    [t],
  );
};
