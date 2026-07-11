import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-none border font-mono text-ui-11 font-normal uppercase tracking-[0.08em] transition-[background-color,border-color,color,transform] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:translate-y-px disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        default:
          "border-border-medium bg-transparent text-text-primary hover:border-border-strong hover:text-text-display",
        outline:
          "border-border bg-surface-100 text-text-primary hover:border-border-medium hover:bg-surface-200 hover:text-text-display",
        ghost:
          "border-transparent bg-transparent text-text-secondary hover:bg-surface-200 hover:text-text-display",
        secondary: "border-accent bg-accent text-white hover:brightness-110 hover:text-white",
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
