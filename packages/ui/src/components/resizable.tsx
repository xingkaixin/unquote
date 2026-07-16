import { GripVertical } from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { cn } from "../lib/utils";

export { useDefaultLayout as useResizablePanelGroupLayout } from "react-resizable-panels";

export const ResizablePanelGroup = ({
  className,
  ...props
}: React.ComponentProps<typeof Group>) => (
  <Group className={cn("flex h-full w-full", className)} {...props} />
);

export const ResizablePanel = Panel;

export const ResizableHandle = ({
  withHandle = true,
  className,
  ...props
}: React.ComponentProps<typeof Separator> & { withHandle?: boolean }) => (
  <Separator
    className={cn(
      "group/resize-handle relative flex w-2 shrink-0 items-center justify-center outline-none transition-colors before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-border data-[separator=active]:before:bg-accent data-[separator=hover]:before:bg-border-medium focus-visible:before:bg-accent aria-[orientation=horizontal]:h-2 aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:before:inset-x-0 aria-[orientation=horizontal]:before:left-0 aria-[orientation=horizontal]:before:h-px aria-[orientation=horizontal]:before:w-full aria-[orientation=horizontal]:before:translate-x-0",
      className,
    )}
    {...props}
  >
    {withHandle ? (
      <div className="z-10 flex h-6 w-2.5 items-center justify-center border border-border bg-surface-100 text-text-muted group-aria-[orientation=horizontal]/resize-handle:h-2.5 group-aria-[orientation=horizontal]/resize-handle:w-6 group-aria-[orientation=horizontal]/resize-handle:rotate-90">
        <GripVertical className="size-3" />
      </div>
    ) : null}
  </Separator>
);
