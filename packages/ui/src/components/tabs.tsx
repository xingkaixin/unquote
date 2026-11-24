import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent,
} from "react";
import { FluidHover } from "./fluid-hover";
import { cn } from "../lib/utils";

interface TabsContextValue {
  value: string | undefined;
  focusedValue: string | undefined;
  setFocusedValue: (next: string | undefined) => void;
  select: (next: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

export interface TabsProps extends HTMLAttributes<HTMLDivElement> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}

export const Tabs = ({
  value: controlledValue,
  defaultValue,
  onValueChange,
  children,
  ...props
}: TabsProps) => {
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const value = controlledValue ?? uncontrolledValue;
  const [focusedValue, setFocusedValue] = useState<string | undefined>(undefined);

  const select = useCallback(
    (next: string) => {
      setFocusedValue(undefined);
      if (controlledValue === undefined) {
        setUncontrolledValue(next);
      }
      onValueChange?.(next);
    },
    [controlledValue, onValueChange],
  );

  const ctx = useMemo(
    () => ({ value, focusedValue: focusedValue ?? value, setFocusedValue, select }),
    [focusedValue, select, value],
  );

  return (
    <TabsContext value={ctx}>
      <div {...props}>{children}</div>
    </TabsContext>
  );
};

export const TabsList = ({
  className,
  children,
  onBlur,
  onKeyDown,
  ...props
}: HTMLAttributes<HTMLDivElement>) => {
  const ctx = useContext(TabsContext);
  const listRef = useRef<HTMLDivElement | null>(null);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) {
      return;
    }

    const list = listRef.current;
    if (!list) {
      return;
    }

    const tabs = Array.from(
      list.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'),
    );
    if (tabs.length === 0) {
      return;
    }

    const activeElement = document.activeElement;
    const currentIndex = tabs.findIndex((tab) => tab === activeElement);
    if (currentIndex === -1) {
      return;
    }

    let nextIndex = -1;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    }

    if (nextIndex !== -1) {
      event.preventDefault();
      const target = tabs[nextIndex];
      const nextValue = target?.dataset.tabValue;
      if (nextValue !== undefined) {
        ctx?.setFocusedValue(nextValue);
      }
      target?.focus();
    }
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      onBlur={(event) => {
        onBlur?.(event);
        const nextFocused = event.relatedTarget;
        if (!(nextFocused instanceof Node) || !listRef.current?.contains(nextFocused)) {
          ctx?.setFocusedValue(undefined);
        }
      }}
      onKeyDown={handleKeyDown}
      className={cn(
        "inline-flex h-7 items-center whitespace-nowrap rounded-md border border-border-medium bg-surface-100 p-0",
        className,
      )}
      {...props}
    >
      <FluidHover axis="x">{children}</FluidHover>
    </div>
  );
};

export interface TabsTriggerProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "value"> {
  value: string;
}

export const TabsTrigger = ({
  className,
  value,
  onClick,
  onFocus,
  onKeyDown,
  ...props
}: TabsTriggerProps) => {
  const ctx = useContext(TabsContext);
  const isActive = ctx?.value === value;
  const isTabbable = ctx?.focusedValue === value;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      data-active={isActive ? "" : undefined}
      data-tab-value={value}
      data-fluid-hover-item=""
      tabIndex={isTabbable ? 0 : -1}
      className={cn(
        "inline-flex h-full items-center rounded-md px-2 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-text-secondary outline-none transition-[color,background-color] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent data-active:bg-accent data-active:text-white sm:px-4",
        className,
      )}
      onFocus={(event) => {
        onFocus?.(event);
        ctx?.setFocusedValue(value);
      }}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented && !props.disabled) {
          ctx?.select(value);
        }
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (
          !event.defaultPrevented &&
          !props.disabled &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault();
          ctx?.select(value);
        }
      }}
      {...props}
    />
  );
};

export interface TabsContentProps extends HTMLAttributes<HTMLDivElement> {
  value: string;
}

export const TabsContent = ({ className, value, ...props }: TabsContentProps) => {
  const ctx = useContext(TabsContext);
  if (ctx?.value !== value) {
    return null;
  }
  return <div role="tabpanel" className={cn("outline-none", className)} {...props} />;
};
