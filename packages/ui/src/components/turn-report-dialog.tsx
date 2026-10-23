import { useState } from "react";
import type { JsonlRecord } from "@unquote/core";
import { useTranslation } from "../i18n/context";
import type { AgentSession, AgentSessionModel } from "../lib/agent-session";
import type { PublishedSourceRevision } from "../lib/published-source";
import { buildTurnReport } from "../lib/turn-report";
import { ReportDialog } from "./report-dialog";

export interface TurnReportDialogProps {
  source: PublishedSourceRevision;
  records: readonly JsonlRecord[];
  format: AgentSession["fileType"];
  model: AgentSessionModel;
  turns: readonly number[];
  onClose: () => void;
}

export const TurnReportDialog = ({
  source,
  records,
  format,
  model,
  turns,
  onClose,
}: TurnReportDialogProps) => {
  const { t } = useTranslation();
  const [includeReasoning, setIncludeReasoning] = useState(false);
  return (
    <ReportDialog
      title={t("turnReport.title")}
      description={t("turnReport.description")}
      markdownFileName="unquote-turns.md"
      failedMessage="turnReport.failed"
      canBuild={turns.length > 0}
      selection={(invalidate) => (
        <>
          <p className="text-xs">{t("turnReport.turns", { turns: turns.join(", ") })}</p>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={includeReasoning}
              onChange={(event) => {
                invalidate();
                setIncludeReasoning(event.target.checked);
              }}
            />
            {t("turnReport.reasoning")}
          </label>
        </>
      )}
      build={(redactions, notes, signal) =>
        buildTurnReport(
          source,
          records,
          format,
          model,
          turns,
          { redactions, notes, includeReasoning },
          signal,
        )
      }
      onClose={onClose}
    />
  );
};
