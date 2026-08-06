import type { ReactNode } from "react";

export interface WorkspaceColumnsProps {
  isDesktop: boolean;
  leftWidth: number;
  rightWidth: number;
  leftMobileHeight: string;
  rightLabel: string;
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
}

// Columns never set `overflow`: each pane owns its own scroller so the
// virtualizer inside it resolves a real getScrollElement() in both branches.
export const WorkspaceColumns = ({
  isDesktop,
  leftWidth,
  rightWidth,
  leftMobileHeight,
  rightLabel,
  left,
  center,
  right,
}: WorkspaceColumnsProps) => {
  if (isDesktop) {
    return (
      <div className="flex min-h-0 flex-1">
        <div
          className="flex min-h-0 shrink-0 flex-col border-r border-border bg-surface-100"
          style={{ width: `${leftWidth}px` }}
        >
          {left}
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{center}</div>
        <div
          className="flex min-h-0 shrink-0 flex-col border-l border-border bg-surface-100"
          style={{ width: `${rightWidth}px` }}
        >
          {right}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="flex min-h-0 shrink-0 flex-col border-b border-border bg-surface-100"
        style={{ height: leftMobileHeight }}
      >
        {left}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{center}</div>
      <details className="max-h-[40vh] shrink-0 overflow-y-auto border-t border-border bg-surface-100">
        <summary className="uq-label cursor-pointer px-4 py-2">{rightLabel}</summary>
        {right}
      </details>
    </div>
  );
};
