import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cn } from "../lib/utils";

export const Tabs = TabsPrimitive.Root;

export const TabsList = ({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) => (
  <TabsPrimitive.List
    className={cn(
      "inline-flex h-9 items-center gap-0.5 rounded-md border-2 border-border bg-surface-200 p-1 shadow-[var(--shadow-sm)]",
      className,
    )}
    {...props}
  />
);

export const TabsTrigger = ({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Tab>) => (
  <TabsPrimitive.Tab
    className={cn(
      "uq-tap inline-flex items-center rounded-sm border-2 border-transparent px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-text-secondary outline-none hover:text-text-display focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent data-active:border-border data-active:bg-surface-100 data-active:text-text-display data-active:shadow-[var(--shadow-xs)]",
      className,
    )}
    {...props}
  />
);

export const TabsContent = ({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Panel>) => (
  <TabsPrimitive.Panel className={cn("outline-none", className)} {...props} />
);
