import { ScanSearch } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "./badge";

interface StatusFooterProps {
  detectedFormat: "json" | "jsonl";
  statsLabel: string;
  pathLabel: string;
  inspector?: ReactNode;
}

export const StatusFooter = ({
  detectedFormat,
  statsLabel,
  pathLabel,
  inspector,
}: StatusFooterProps) => (
  <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-[var(--background)]/80 px-4 py-2 backdrop-blur-md">
    <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-2 lg:px-2">
      {inspector}
      <div className="flex items-center gap-2">
        <Badge className="shrink-0 border-transparent bg-[oklab(0.15_0_0)] text-white">
          {detectedFormat}
        </Badge>
        <Badge className="min-w-0 max-w-[48vw] shrink-0 truncate">{statsLabel}</Badge>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-surface-200 px-2.5 py-0.5">
          <ScanSearch className="size-3 shrink-0 text-text-muted" />
          <span className="min-w-0 truncate font-mono text-[11px] text-text-secondary">
            {pathLabel}
          </span>
        </div>
      </div>
    </div>
  </footer>
);
