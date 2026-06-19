import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

export const Toaster = ({ ...props }: ToasterProps) => (
  <Sonner
    className="toaster group"
    position="top-center"
    richColors
    closeButton
    style={
      {
        "--normal-bg": "var(--color-surface-100)",
        "--normal-text": "var(--color-text-primary)",
        "--normal-border": "var(--color-border)",
      } as CSSProperties
    }
    {...props}
  />
);
