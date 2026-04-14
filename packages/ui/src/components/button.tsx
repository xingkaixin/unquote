import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-[13px] font-medium tracking-[0.01em] transition-[transform,box-shadow,background-color,border-color,color] duration-150 ease-out disabled:pointer-events-none disabled:opacity-50 active:translate-y-px",
  {
    variants: {
      variant: {
        default:
          "bg-surface-300 text-text-primary shadow-sm hover:-translate-y-px hover:text-accent-hover hover:shadow-md",
        outline:
          "border border-border bg-transparent text-text-primary hover:-translate-y-px hover:bg-surface-300 hover:text-accent-hover",
        ghost: "text-text-secondary hover:bg-[rgba(38,37,30,0.06)] hover:text-text-primary",
        secondary:
          "bg-accent text-white shadow-sm hover:-translate-y-px hover:brightness-110 hover:shadow-md",
      },
      size: {
        default: "h-8 px-3",
        sm: "h-7 px-2.5 text-[12px]",
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
