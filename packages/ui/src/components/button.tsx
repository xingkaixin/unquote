import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-xl text-[13px] font-medium tracking-[0.01em] transition-[transform,box-shadow,background-color,border-color,color] duration-150 ease-out disabled:pointer-events-none disabled:opacity-50 active:translate-y-px",
  {
    variants: {
      variant: {
        default:
          "bg-zinc-900 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_8px_18px_rgba(24,24,27,0.18)] hover:-translate-y-px hover:bg-zinc-800 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_12px_24px_rgba(24,24,27,0.2)] dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200",
        outline:
          "border border-zinc-300 bg-white text-zinc-800 shadow-[0_1px_0_rgba(24,24,27,0.04)] hover:-translate-y-px hover:bg-zinc-50 hover:shadow-[0_10px_24px_rgba(24,24,27,0.08)] dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900",
        ghost: "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900",
        secondary:
          "bg-amber-100 text-amber-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_10px_24px_rgba(245,158,11,0.14)] hover:-translate-y-px hover:bg-amber-200 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_14px_28px_rgba(245,158,11,0.18)] dark:bg-amber-500/15 dark:text-amber-200",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-9 px-3.5 text-[12px]",
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
