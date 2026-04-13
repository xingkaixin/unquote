import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em]",
  {
    variants: {
      variant: {
        default: "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300",
        warning:
          "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200",
        success:
          "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200",
        danger:
          "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-200",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export const Badge = ({ className, variant, ...props }: BadgeProps) => (
  <div className={cn(badgeVariants({ variant }), className)} {...props} />
);
