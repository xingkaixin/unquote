import { GripVertical } from "lucide-react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";
import { cn } from "../lib/utils";

export type { ImperativePanelHandle };

export const ResizablePanelGroup = ({
  className,
  ...props
}: React.ComponentProps<typeof PanelGroup>) => (
  <PanelGroup
    className={cn("flex h-full w-full data-[panel-group-direction=vertical]:flex-col", className)}
    {...props}
  />
);

export const ResizablePanel = Panel;

export const ResizableHandle = ({
  withHandle = true,
  className,
  ...props
}: React.ComponentProps<typeof PanelResizeHandle> & { withHandle?: boolean }) => (
  <PanelResizeHandle
    className={cn(
      "relative flex w-2 shrink-0 items-center justify-center outline-none transition-colors before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-border data-[resize-handle-state=drag]:before:bg-accent data-[resize-handle-state=hover]:before:bg-border-medium focus-visible:before:bg-accent data-[panel-group-direction=vertical]:h-2 data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:before:inset-x-0 data-[panel-group-direction=vertical]:before:left-0 data-[panel-group-direction=vertical]:before:h-px data-[panel-group-direction=vertical]:before:w-full data-[panel-group-direction=vertical]:before:translate-x-0",
      className,
    )}
    {...props}
  >
    {withHandle ? (
      <div className="z-10 flex h-6 w-2.5 items-center justify-center border border-border bg-surface-100 text-text-muted data-[panel-group-direction=vertical]:h-2.5 data-[panel-group-direction=vertical]:w-6 data-[panel-group-direction=vertical]:rotate-90">
        <GripVertical className="size-3" />
      </div>
    ) : null}
  </PanelResizeHandle>
);
