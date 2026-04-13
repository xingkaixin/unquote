import * as React from "react";
import { cn } from "../lib/utils";

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-2xl border border-zinc-200/80 bg-white/95 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/85",
        className,
      )}
      {...props}
    />
  ),
);

Card.displayName = "Card";

export const CardHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col gap-1 border-b border-zinc-200/70 px-4 py-3 dark:border-zinc-800",
      className,
    )}
    {...props}
  />
);

export const CardTitle = ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3
    className={cn(
      "text-sm font-semibold tracking-wide text-zinc-900 dark:text-zinc-100",
      className,
    )}
    {...props}
  />
);

export const CardDescription = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn("text-xs text-zinc-500 dark:text-zinc-400", className)} {...props} />
);

export const CardContent = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("px-4 py-3", className)} {...props} />
);
