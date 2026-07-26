import { useCallback } from "react";
import { toast } from "sonner";
import { useTranslation } from "../i18n/context";
import { writeClipboardText } from "../lib/clipboard";

export const useCopyToClipboard = () => {
  const { t } = useTranslation();

  return useCallback(
    async (text: string) => {
      if (!(await writeClipboardText(text))) {
        toast.error(t("copy.failed"));
      }
    },
    [t],
  );
};
