import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "../lib/utils";

export const Tabs = TabsPrimitive.Root;

export const TabsList = ({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) => (
  <TabsPrimitive.List
    className={cn(
      "inline-flex h-10 items-center rounded-lg border border-zinc-200 bg-zinc-100/80 p-1 dark:border-zinc-800 dark:bg-zinc-900",
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
      "inline-flex items-center rounded-md px-3 py-1.5 text-sm text-zinc-500 data-[state=active]:bg-white data-[state=active]:text-zinc-900 dark:text-zinc-400 dark:data-[state=active]:bg-zinc-950 dark:data-[state=active]:text-zinc-50",
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
