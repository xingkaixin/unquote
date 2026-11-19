import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { FluidHover } from "./fluid-hover";
import { cn } from "../lib/utils";

export const Tabs = TabsPrimitive.Root;

export const TabsList = ({
  className,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) => (
  <TabsPrimitive.List
    className={cn(
      "inline-flex h-7 items-center whitespace-nowrap rounded-md border border-border-medium bg-surface-100 p-0",
      className,
    )}
    {...props}
  >
    <FluidHover axis="x">{children}</FluidHover>
  </TabsPrimitive.List>
);

export const TabsTrigger = ({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Tab>) => (
  <TabsPrimitive.Tab
    data-fluid-hover-item
    className={cn(
      "inline-flex h-full items-center rounded-md px-2 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-text-secondary outline-none transition-[color,background-color] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent data-active:bg-accent data-active:text-white sm:px-4",
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
