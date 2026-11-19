import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center border uq-text-11 font-normal transition-[background-color,border-color,color,transform] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:translate-y-px disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        default:
          "border-border-medium bg-transparent text-text-secondary hover:border-accent hover:text-accent",
        outline:
          "border-border bg-surface-100 text-text-primary hover:border-border-medium hover:bg-surface-200",
        ghost:
          "border-transparent bg-transparent text-text-secondary hover:bg-surface-200 hover:text-text-primary",
        secondary: "border-accent bg-accent text-white hover:brightness-110 hover:text-white",
        selected: "border-accent bg-accent-soft text-text-primary hover:bg-accent-soft",
      },
      size: {
        default: "h-9 gap-2 px-3",
        sm: "h-7 gap-2 px-2",
        xs: "h-6 gap-1.5 px-2.5",
        icon: "size-7 p-0",
        "icon-xs": "size-6 p-0",
      },
      radius: {
        md: "rounded-md",
        sm: "rounded-sm",
        xs: "rounded-xs",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      radius: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, radius, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size, radius }), className)}
      {...props}
    />
  ),
);

Button.displayName = "Button";
