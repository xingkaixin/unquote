import {
  cloneElement,
  createContext,
  forwardRef,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/utils";

interface TooltipProviderConfig {
  delay: number;
  closeDelay: number;
}

const TooltipProviderContext = createContext<TooltipProviderConfig>({
  delay: 600,
  closeDelay: 0,
});

export interface TooltipProviderProps {
  delay?: number;
  closeDelay?: number;
  children: ReactNode;
}

export const TooltipProvider = ({
  delay = 600,
  closeDelay = 0,
  children,
}: TooltipProviderProps) => {
  const value = useMemo(() => ({ delay, closeDelay }), [closeDelay, delay]);
  return <TooltipProviderContext value={value}>{children}</TooltipProviderContext>;
};

interface TooltipContextValue {
  open: boolean;
  contentId: string;
  triggerRef: RefObject<HTMLElement | null>;
  openWithDelay: () => void;
  openImmediately: () => void;
  closeWithDelay: () => void;
  closeImmediately: () => void;
}

const TooltipContext = createContext<TooltipContextValue | null>(null);

export interface TooltipProps {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

export const Tooltip = ({
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  children,
}: TooltipProps) => {
  const { delay, closeDelay } = useContext(TooltipProviderContext);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const contentId = useId();
  const triggerRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) {
        setUncontrolledOpen(next);
      }
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange],
  );

  const openWithDelay = useCallback(() => {
    clearTimer();
    if (delay <= 0) {
      setOpen(true);
      return;
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setOpen(true);
    }, delay);
  }, [clearTimer, delay, setOpen]);

  const openImmediately = useCallback(() => {
    clearTimer();
    setOpen(true);
  }, [clearTimer, setOpen]);

  const closeWithDelay = useCallback(() => {
    clearTimer();
    if (closeDelay <= 0) {
      setOpen(false);
      return;
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setOpen(false);
    }, closeDelay);
  }, [clearTimer, closeDelay, setOpen]);

  const closeImmediately = useCallback(() => {
    clearTimer();
    setOpen(false);
  }, [clearTimer, setOpen]);

  useEffect(() => clearTimer, [clearTimer]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeImmediately();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeImmediately, open]);

  const value = useMemo<TooltipContextValue>(
    () => ({
      open,
      contentId,
      triggerRef,
      openWithDelay,
      openImmediately,
      closeWithDelay,
      closeImmediately,
    }),
    [closeImmediately, closeWithDelay, contentId, open, openImmediately, openWithDelay],
  );

  return <TooltipContext value={value}>{children}</TooltipContext>;
};

type TriggerElementProps = HTMLAttributes<HTMLElement> & {
  ref?: Ref<HTMLElement>;
};

const assignRef = <T,>(ref: Ref<T> | undefined, value: T | null) => {
  if (typeof ref === "function") {
    ref(value);
  } else if (ref && "current" in ref) {
    ref.current = value;
  }
};

export interface TooltipTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  render?: ReactElement<TriggerElementProps>;
}

export const TooltipTrigger = ({ render, children, ...props }: TooltipTriggerProps) => {
  const ctx = useContext(TooltipContext);

  const triggerHandlers = {
    onMouseEnter: () => ctx?.openWithDelay(),
    onMouseLeave: () => ctx?.closeWithDelay(),
    onFocus: () => ctx?.openImmediately(),
    onBlur: () => ctx?.closeImmediately(),
    onPointerDown: () => ctx?.closeImmediately(),
  };

  if (render && isValidElement<TriggerElementProps>(render)) {
    const existingProps = render.props;
    return cloneElement(render, {
      ...props,
      ...existingProps,
      "aria-describedby": ctx?.open ? ctx.contentId : existingProps["aria-describedby"],
      ref: (node: HTMLElement | null) => {
        if (ctx) {
          ctx.triggerRef.current = node;
        }
        assignRef(existingProps.ref, node);
      },
      onMouseEnter: (event) => {
        existingProps.onMouseEnter?.(event);
        triggerHandlers.onMouseEnter();
      },
      onMouseLeave: (event) => {
        existingProps.onMouseLeave?.(event);
        triggerHandlers.onMouseLeave();
      },
      onFocus: (event) => {
        existingProps.onFocus?.(event);
        triggerHandlers.onFocus();
      },
      onBlur: (event) => {
        existingProps.onBlur?.(event);
        triggerHandlers.onBlur();
      },
      onPointerDown: (event) => {
        existingProps.onPointerDown?.(event);
        triggerHandlers.onPointerDown();
      },
    });
  }

  return (
    <button
      type="button"
      ref={(node) => {
        if (ctx) {
          ctx.triggerRef.current = node;
        }
      }}
      aria-describedby={ctx?.open ? ctx.contentId : undefined}
      {...props}
      onMouseEnter={(event) => {
        props.onMouseEnter?.(event);
        triggerHandlers.onMouseEnter();
      }}
      onMouseLeave={(event) => {
        props.onMouseLeave?.(event);
        triggerHandlers.onMouseLeave();
      }}
      onFocus={(event) => {
        props.onFocus?.(event);
        triggerHandlers.onFocus();
      }}
      onBlur={(event) => {
        props.onBlur?.(event);
        triggerHandlers.onBlur();
      }}
      onPointerDown={(event) => {
        props.onPointerDown?.(event);
        triggerHandlers.onPointerDown();
      }}
    >
      {children}
    </button>
  );
};

export interface TooltipContentProps extends HTMLAttributes<HTMLDivElement> {
  sideOffset?: number;
}

export const TooltipContent = forwardRef<HTMLDivElement, TooltipContentProps>(
  ({ className, sideOffset = 6, style, ...props }, ref) => {
    const ctx = useContext(TooltipContext);
    const popupRef = useRef<HTMLDivElement | null>(null);
    const [coords, setCoords] = useState<{ x: number; y: number }>({ x: 0, y: -sideOffset });

    useLayoutEffect(() => {
      if (!ctx?.open) {
        return;
      }
      const trigger = ctx.triggerRef.current;
      const popup = popupRef.current;
      if (!trigger || !popup) {
        setCoords({ x: 0, y: -sideOffset });
        return;
      }
      const triggerRect = trigger.getBoundingClientRect();
      const popupRect = popup.getBoundingClientRect();
      if (triggerRect.width === 0 && triggerRect.height === 0) {
        setCoords({ x: 0, y: -sideOffset });
        return;
      }
      const rawX = triggerRect.left + (triggerRect.width - popupRect.width) / 2;
      const x = Math.round(
        Math.max(8, Math.min(rawX, Math.max(8, window.innerWidth - popupRect.width - 8))),
      );
      const aboveY = triggerRect.top - popupRect.height - sideOffset;
      const y = Math.round(aboveY >= 8 ? aboveY : triggerRect.bottom + sideOffset);
      setCoords({ x, y });
    }, [ctx?.open, ctx?.triggerRef, sideOffset]);

    if (!ctx?.open || typeof document === "undefined") {
      return null;
    }

    return createPortal(
      <div
        className="pointer-events-none fixed left-0 top-0 z-50"
        style={{ transform: `translate(${coords.x}px, ${coords.y}px)` }}
      >
        <div
          ref={(node) => {
            popupRef.current = node;
            assignRef(ref, node);
          }}
          id={ctx.contentId}
          role="tooltip"
          className={cn(
            "rounded-md border border-border-medium bg-surface-50 px-2 py-1 text-[12px] text-text-primary shadow-[var(--shadow-panel)]",
            className,
          )}
          style={style}
          {...props}
        />
      </div>,
      document.body,
    );
  },
);

TooltipContent.displayName = "TooltipContent";
