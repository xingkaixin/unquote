import {
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { FluidHover } from "./fluid-hover";
import { cn } from "../lib/utils";

interface DropdownMenuContextValue {
  open: boolean;
  setOpen: (next: boolean) => void;
  closeAndRestoreFocus: () => void;
  triggerRef: RefObject<HTMLElement | null>;
  popupRef: RefObject<HTMLDivElement | null>;
}

const DropdownMenuContext = createContext<DropdownMenuContextValue | null>(null);

interface RadioGroupContextValue {
  value: string;
  onValueChange: (value: string) => void;
}

const RadioGroupContext = createContext<RadioGroupContextValue | null>(null);

const assignRef = <T,>(ref: Ref<T> | undefined, value: T | null) => {
  if (typeof ref === "function") {
    ref(value);
  } else if (ref && "current" in ref) {
    ref.current = value;
  }
};

export interface DropdownMenuProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

export const DropdownMenu = ({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  children,
}: DropdownMenuProps) => {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const triggerRef = useRef<HTMLElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);

  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) {
        setUncontrolledOpen(next);
      }
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange],
  );

  const closeAndRestoreFocus = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, [setOpen]);

  const value = useMemo<DropdownMenuContextValue>(
    () => ({ open, setOpen, closeAndRestoreFocus, triggerRef, popupRef }),
    [closeAndRestoreFocus, open, setOpen],
  );

  return <DropdownMenuContext value={value}>{children}</DropdownMenuContext>;
};

type TriggerElementProps = HTMLAttributes<HTMLElement> & {
  disabled?: boolean | undefined;
  ref?: Ref<HTMLElement> | undefined;
};

export interface DropdownMenuTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  render?: ReactElement<TriggerElementProps>;
}

export const DropdownMenuTrigger = ({ render, children, ...props }: DropdownMenuTriggerProps) => {
  const ctx = useContext(DropdownMenuContext);

  const toggle = () => {
    ctx?.setOpen(!ctx.open);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      if (!ctx?.open) {
        event.preventDefault();
        ctx?.setOpen(true);
      }
    }
  };

  if (render && isValidElement<TriggerElementProps>(render)) {
    const existingProps = render.props;
    return cloneElement(render, {
      ...props,
      ...existingProps,
      "aria-haspopup": "menu",
      "aria-expanded": ctx?.open ?? false,
      ref: (node: HTMLElement | null) => {
        if (ctx) {
          ctx.triggerRef.current = node;
        }
        assignRef(existingProps.ref, node);
      },
      onClick: (event) => {
        existingProps.onClick?.(event);
        if (!event.defaultPrevented && !existingProps.disabled) {
          toggle();
        }
      },
      onKeyDown: (event) => {
        existingProps.onKeyDown?.(event);
        if (!event.defaultPrevented && !existingProps.disabled) {
          handleKeyDown(event);
        }
      },
    });
  }

  return (
    <button
      type="button"
      aria-haspopup="menu"
      aria-expanded={ctx?.open ?? false}
      ref={(node) => {
        if (ctx) {
          ctx.triggerRef.current = node;
        }
      }}
      {...props}
      onClick={(event) => {
        props.onClick?.(event);
        if (!event.defaultPrevented && !props.disabled) {
          toggle();
        }
      }}
      onKeyDown={(event) => {
        props.onKeyDown?.(event);
        if (!event.defaultPrevented && !props.disabled) {
          handleKeyDown(event);
        }
      }}
    >
      {children}
    </button>
  );
};

export interface DropdownMenuRadioGroupProps<T extends string = string> {
  value: T;
  onValueChange: (value: T) => void;
  children: ReactNode;
}

export const DropdownMenuRadioGroup = <T extends string = string>({
  value,
  onValueChange,
  children,
}: DropdownMenuRadioGroupProps<T>) => {
  const ctx = useMemo<RadioGroupContextValue>(
    () => ({
      value,
      // SAFETY: Radio items inside this group carry values from the caller's T union.
      onValueChange: (next) => onValueChange(next as T),
    }),
    [onValueChange, value],
  );
  return <RadioGroupContext value={ctx}>{children}</RadioGroupContext>;
};

const menuItemSelector =
  '[role="menuitem"]:not([aria-disabled="true"]):not([data-disabled]), [role="menuitemradio"]:not([aria-disabled="true"]):not([data-disabled])';

export interface DropdownMenuContentProps extends HTMLAttributes<HTMLDivElement> {
  align?: "start" | "center" | "end";
}

export const DropdownMenuContent = ({
  className,
  align = "start",
  children,
  style,
  onKeyDown,
  ...props
}: DropdownMenuContentProps) => {
  const ctx = useContext(DropdownMenuContext);
  const [starting, setStarting] = useState(true);
  const [positionStyle, setPositionStyle] = useState<CSSProperties>({
    top: 0,
    left: 0,
  });

  useLayoutEffect(() => {
    if (!ctx?.open) {
      setStarting(true);
      return;
    }

    const trigger = ctx.triggerRef.current;
    const popup = ctx.popupRef.current;
    if (!trigger || !popup) {
      return;
    }

    const triggerRect = trigger.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const sideOffset = 8;
    const viewportWidth = window.innerWidth || 1024;
    const viewportHeight = window.innerHeight || 768;

    let left = triggerRect.left;
    if (align === "end") {
      left = triggerRect.right - popupRect.width;
    } else if (align === "center") {
      left = triggerRect.left + (triggerRect.width - popupRect.width) / 2;
    }
    left = Math.max(8, Math.min(left, Math.max(8, viewportWidth - popupRect.width - 8)));

    const belowTop = triggerRect.bottom + sideOffset;
    const fitsBelow = belowTop + popupRect.height <= viewportHeight - 8;
    const top = fitsBelow ? belowTop : Math.max(8, triggerRect.top - popupRect.height - sideOffset);

    setPositionStyle({
      top: Math.round(top),
      left: Math.round(left),
      // SAFETY: CSS custom property used by .uq-dropdown-popup transform-origin.
      ["--transform-origin" as keyof CSSProperties]: fitsBelow
        ? align === "end"
          ? "top right"
          : "top left"
        : align === "end"
          ? "bottom right"
          : "bottom left",
    });

    const frame = requestAnimationFrame(() => setStarting(false));
    if (!popup.contains(document.activeElement)) {
      popup.querySelector<HTMLElement>(menuItemSelector)?.focus({ preventScroll: true });
    }
    return () => cancelAnimationFrame(frame);
  }, [align, ctx?.open, ctx?.popupRef, ctx?.triggerRef]);

  useEffect(() => {
    if (!ctx?.open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (ctx.popupRef.current?.contains(target) || ctx.triggerRef.current?.contains(target)) {
        return;
      }
      ctx.setOpen(false);
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        ctx.closeAndRestoreFocus();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [ctx]);

  if (!ctx?.open || typeof document === "undefined") {
    return null;
  }

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) {
      return;
    }

    if (event.key === "Tab") {
      // Restore focus to the trigger before the browser advances Tab order out
      // of the portaled menu, so Tab / Shift+Tab land on adjacent controls.
      ctx.closeAndRestoreFocus();
      return;
    }

    const popup = ctx.popupRef.current;
    if (!popup) {
      return;
    }
    const items = Array.from(popup.querySelectorAll<HTMLElement>(menuItemSelector));
    if (items.length === 0) {
      return;
    }

    const currentIndex = items.findIndex((item) => item === document.activeElement);
    let nextIndex = -1;
    if (event.key === "ArrowDown") {
      nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % items.length;
    } else if (event.key === "ArrowUp") {
      nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = items.length - 1;
    }

    if (nextIndex !== -1) {
      event.preventDefault();
      items[nextIndex]?.focus();
    }
  };

  return createPortal(
    <div
      ref={ctx.popupRef}
      role="menu"
      data-starting-style={starting ? "" : undefined}
      onKeyDown={handleMenuKeyDown}
      style={{ position: "fixed", zIndex: 50, ...positionStyle, ...style }}
      className={cn(
        "uq-dropdown-popup min-w-40 rounded-xl border border-border-medium bg-surface-100 p-1 shadow-[var(--shadow-panel)] outline-none",
        className,
      )}
      {...props}
    >
      <FluidHover>{children}</FluidHover>
    </div>,
    document.body,
  );
};

const itemClassName =
  "flex cursor-pointer select-none items-center rounded-none px-3 py-2 font-mono uq-text-11 uppercase tracking-[0.08em] outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent data-highlighted:bg-surface-200 data-highlighted:text-text-primary";

export interface DropdownMenuItemProps extends HTMLAttributes<HTMLDivElement> {
  disabled?: boolean;
}

export const DropdownMenuItem = ({
  className,
  disabled = false,
  onClick,
  onKeyDown,
  ...props
}: DropdownMenuItemProps) => {
  const ctx = useContext(DropdownMenuContext);

  const activate = (event: MouseEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }
    onClick?.(event);
    ctx?.closeAndRestoreFocus();
  };

  return (
    <div
      role="menuitem"
      tabIndex={disabled ? undefined : -1}
      aria-disabled={disabled || undefined}
      data-disabled={disabled ? "" : undefined}
      data-fluid-hover-item=""
      className={cn(
        itemClassName,
        disabled ? "cursor-default text-text-tertiary" : "text-text-secondary",
        className,
      )}
      onClick={activate}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (!event.defaultPrevented && !disabled && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          event.currentTarget.click();
        }
      }}
      {...props}
    />
  );
};

export interface DropdownMenuRadioItemProps extends HTMLAttributes<HTMLDivElement> {
  value: string;
  closeOnClick?: boolean;
  disabled?: boolean;
}

export const DropdownMenuRadioItem = ({
  className,
  value,
  closeOnClick = true,
  disabled = false,
  onClick,
  onKeyDown,
  ...props
}: DropdownMenuRadioItemProps) => {
  const menu = useContext(DropdownMenuContext);
  const radioGroup = useContext(RadioGroupContext);
  const checked = radioGroup?.value === value;

  const activate = (event: MouseEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }
    onClick?.(event);
    radioGroup?.onValueChange(value);
    if (closeOnClick) {
      menu?.closeAndRestoreFocus();
    }
  };

  return (
    <div
      role="menuitemradio"
      tabIndex={disabled ? undefined : -1}
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      data-disabled={disabled ? "" : undefined}
      data-fluid-hover-item=""
      className={cn(
        itemClassName,
        disabled ? "cursor-default text-text-tertiary" : "text-text-secondary",
        className,
      )}
      onClick={activate}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (!event.defaultPrevented && !disabled && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          event.currentTarget.click();
        }
      }}
      {...props}
    />
  );
};
