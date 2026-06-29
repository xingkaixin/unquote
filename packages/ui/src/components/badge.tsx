import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-none border border-transparent px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase leading-none tracking-[0.12em]",
  {
    variants: {
      variant: {
        default: "text-text-muted",
        warning: "text-accent",
        success: "text-success",
        danger: "border-error text-error",
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
