import { useEffect, type CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

let mountedToasterCount = 0;

let readyResolvers: Array<() => void> = [];

export const waitForToasterMount = (): Promise<void> =>
  mountedToasterCount > 0
    ? Promise.resolve()
    : new Promise((resolve) => {
        readyResolvers.push(resolve);
      });

export const Toaster = ({ ...props }: ToasterProps) => {
  useEffect(() => {
    mountedToasterCount += 1;
    const resolvers = readyResolvers.splice(0, readyResolvers.length);
    for (const resolve of resolvers) {
      resolve();
    }
    return () => {
      mountedToasterCount -= 1;
    };
  }, []);

  return (
    <Sonner
      className="toaster group"
      position="top-center"
      richColors
      closeButton
      style={
        // SAFETY: Sonner accepts CSS custom properties, which React CSSProperties does not enumerate.
        {
          "--normal-bg": "var(--color-surface-100)",
          "--normal-text": "var(--color-text-primary)",
          "--normal-border": "var(--color-border)",
        } as CSSProperties
      }
      {...props}
    />
  );
};
