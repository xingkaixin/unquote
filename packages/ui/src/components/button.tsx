import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-md text-ui-11 font-medium transition-[background-color,border-color,color] duration-150 ease-out disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-surface-300 text-text-primary hover:bg-surface-400 hover:text-accent-hover",
        outline:
          "border border-border bg-transparent text-text-primary hover:bg-surface-300 hover:text-accent-hover",
        ghost: "text-text-secondary hover:bg-[rgba(38,37,30,0.06)] hover:text-text-primary",
        secondary: "bg-accent text-white hover:brightness-110",
      },
      size: {
        default: "h-8 px-2.5",
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
