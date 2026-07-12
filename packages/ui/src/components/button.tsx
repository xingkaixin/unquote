import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md border-2 font-mono text-ui-11 font-bold uppercase tracking-[0.08em] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none",
  {
    variants: {
      variant: {
        default:
          "uq-press border-border bg-surface-100 text-text-primary shadow-[var(--shadow-sm)] hover:bg-surface-200 hover:text-text-display",
        outline:
          "uq-press border-border bg-transparent text-text-primary shadow-[var(--shadow-sm)] hover:bg-surface-200 hover:text-text-display",
        ghost:
          "uq-tap border-transparent bg-transparent text-text-secondary shadow-none hover:bg-surface-200 hover:text-text-display",
        primary:
          "uq-press border-border bg-[var(--color-primary)] text-[var(--color-primary-ink)] shadow-[var(--shadow-md)] hover:bg-[var(--color-accent-hover)] hover:text-[var(--color-primary-ink)]",
        secondary:
          "uq-press border-border bg-[var(--color-secondary)] text-[var(--color-secondary-ink)] shadow-[var(--shadow-md)] hover:brightness-105 hover:text-[var(--color-secondary-ink)]",
        danger:
          "uq-press border-border bg-[var(--color-error)] text-white shadow-[var(--shadow-md)] hover:brightness-105 hover:text-white",
      },
      size: {
        default: "h-9 px-3",
        sm: "h-7 px-2 text-ui-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);

Button.displayName = "Button";
