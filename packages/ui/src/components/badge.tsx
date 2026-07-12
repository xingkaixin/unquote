import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-sm border border-border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase leading-none tracking-[0.12em]",
  {
    variants: {
      variant: {
        default: "bg-surface-200 text-text-secondary",
        warning: "bg-[var(--warning-soft)] text-[var(--color-warning)]",
        success: "bg-[var(--success-soft)] text-[var(--color-success)]",
        danger: "bg-[var(--danger-soft)] text-[var(--color-error)]",
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
