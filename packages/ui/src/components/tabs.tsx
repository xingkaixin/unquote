import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "../lib/utils";

export const Tabs = TabsPrimitive.Root;

export const TabsList = ({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) => (
  <TabsPrimitive.List
    className={cn(
      "inline-flex h-9 items-center rounded-md border border-border bg-surface-200 p-0.5",
      className,
    )}
    {...props}
  />
);

export const TabsTrigger = ({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) => (
  <TabsPrimitive.Trigger
    className={cn(
      "inline-flex items-center rounded-sm px-3 py-1.5 text-[13px] text-text-secondary outline-none transition-[color,background-color] duration-150 data-[state=active]:bg-surface-100 data-[state=active]:text-text-primary data-[state=active]:shadow-sm",
      className,
    )}
    {...props}
  />
);

export const TabsContent = ({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) => (
  <TabsPrimitive.Content className={cn("outline-none", className)} {...props} />
);
