import * as SeparatorPrimitive from "@radix-ui/react-separator";
import { cn } from "../lib/utils";

export const Separator = ({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) => (
  <SeparatorPrimitive.Root
    decorative
    orientation={orientation}
    className={cn(
      "shrink-0 bg-zinc-200 dark:bg-zinc-800",
      orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
      className,
    )}
    {...props}
  />
);
