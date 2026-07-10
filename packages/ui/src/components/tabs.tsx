import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cn } from "../lib/utils";

export const Tabs = TabsPrimitive.Root;

export const TabsList = ({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) => (
  <TabsPrimitive.List
    className={cn(
      "inline-flex h-9 items-center rounded-none border border-border bg-surface-200 p-0.5",
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
      "inline-flex items-center rounded-none px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-text-secondary outline-none transition-[color,background-color] duration-150 data-active:bg-surface-100 data-active:text-text-display",
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
