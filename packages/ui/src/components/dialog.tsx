import {
  cloneElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  HTMLAttributes,
  KeyboardEvent,
  MouseEvent,
  ReactElement,
  ReactNode,
  RefObject,
} from "react";
import { createPortal } from "react-dom";

interface DialogContextValue {
  open: boolean;
  onOpenChange: ((open: boolean) => void) | undefined;
  titleId: string;
  descriptionId: string;
  hasDescription: boolean;
  registerDescription: () => () => void;
  starting: boolean;
}

const DialogContext = createContext<DialogContextValue | null>(null);

const useDialogContext = () => {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error("Dialog components must be rendered within Dialog.Root");
  }
  return context;
};

const focusableSelector =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const getFocusableElements = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) => element.tabIndex >= 0 && !element.hasAttribute("inert"),
  );

interface DialogRootProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}

const DialogRoot = ({ open = false, onOpenChange, children }: DialogRootProps) => {
  const titleId = useId();
  const descriptionId = useId();
  const [descriptionCount, setDescriptionCount] = useState(0);
  const [starting, setStarting] = useState(open);

  useEffect(() => {
    if (!open) {
      setStarting(true);
      return;
    }

    setStarting(true);
    const frame = requestAnimationFrame(() => setStarting(false));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const registerDescription = useCallback(() => {
    setDescriptionCount((count) => count + 1);
    return () => setDescriptionCount((count) => Math.max(0, count - 1));
  }, []);

  const contextValue = useMemo<DialogContextValue>(
    () => ({
      open,
      onOpenChange,
      titleId,
      descriptionId,
      hasDescription: descriptionCount > 0,
      registerDescription,
      starting,
    }),
    [descriptionCount, descriptionId, onOpenChange, open, registerDescription, starting, titleId],
  );

  return <DialogContext.Provider value={contextValue}>{children}</DialogContext.Provider>;
};

const inertCountByElement = new WeakMap<HTMLElement, number>();

const acquireBackgroundInert = (portalElement: HTMLElement) => {
  const locked: HTMLElement[] = [];
  for (const child of Array.from(document.body.children)) {
    if (
      !(child instanceof HTMLElement) ||
      child === portalElement ||
      child.hasAttribute("data-dialog-portal")
    ) {
      continue;
    }
    const count = inertCountByElement.get(child) ?? 0;
    if (count === 0) {
      child.inert = true;
    }
    inertCountByElement.set(child, count + 1);
    locked.push(child);
  }
  return () => {
    for (const child of locked) {
      const next = (inertCountByElement.get(child) ?? 1) - 1;
      if (next <= 0) {
        inertCountByElement.delete(child);
        child.inert = false;
      } else {
        inertCountByElement.set(child, next);
      }
    }
  };
};

interface DialogPortalProps {
  children?: ReactNode;
}

const DialogPortal = ({ children }: DialogPortalProps) => {
  const { open } = useDialogContext();
  const portalRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !portalRef.current) {
      return;
    }

    return acquireBackgroundInert(portalRef.current);
  }, [open]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div ref={portalRef} data-dialog-portal="">
      {children}
    </div>,
    document.body,
  );
};

interface DialogBackdropProps extends HTMLAttributes<HTMLDivElement> {}

const DialogBackdrop = ({ onClick, onMouseDown, ...props }: DialogBackdropProps) => {
  const { onOpenChange, starting } = useDialogContext();
  return (
    <div
      aria-hidden="true"
      data-starting-style={starting ? "" : undefined}
      onMouseDown={(event) => {
        onMouseDown?.(event);
        if (!event.defaultPrevented) {
          // Keep focus inside the dialog if a non-dismissible modal stays open.
          event.preventDefault();
        }
      }}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          onOpenChange?.(false);
        }
      }}
      {...props}
    />
  );
};

interface DialogViewportProps extends HTMLAttributes<HTMLDivElement> {}

const DialogViewport = ({ onClick, onMouseDown, ...props }: DialogViewportProps) => {
  const { onOpenChange } = useDialogContext();
  return (
    <div
      onMouseDown={(event) => {
        onMouseDown?.(event);
        if (!event.defaultPrevented && event.target === event.currentTarget) {
          event.preventDefault();
        }
      }}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented && event.target === event.currentTarget) {
          onOpenChange?.(false);
        }
      }}
      {...props}
    />
  );
};

interface DialogPopupProps extends HTMLAttributes<HTMLDivElement> {
  initialFocus?: RefObject<HTMLElement | null>;
}

const DialogPopup = ({ initialFocus, onKeyDown, ...props }: DialogPopupProps) => {
  const { open, onOpenChange, titleId, descriptionId, hasDescription, starting } =
    useDialogContext();
  const popupRef = useRef<HTMLDivElement>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    const popup = popupRef.current;
    if (!popup) {
      return;
    }

    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTarget = initialFocus?.current ?? getFocusableElements(popup)[0] ?? popup;
    if (!popup.contains(document.activeElement)) {
      focusTarget.focus({ preventScroll: true });
    }

    return () => {
      if (
        previousFocus &&
        previousFocus.isConnected &&
        (document.activeElement === document.body || popup.contains(document.activeElement))
      ) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [initialFocus, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      onOpenChangeRef.current?.(false);
    };

    document.addEventListener("keydown", handleDocumentKeyDown);
    return () => document.removeEventListener("keydown", handleDocumentKeyDown);
  }, [open]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.key !== "Tab") {
      return;
    }

    const popup = popupRef.current;
    if (!popup) {
      return;
    }

    const focusables = getFocusableElements(popup);
    if (focusables.length === 0) {
      event.preventDefault();
      popup.focus({ preventScroll: true });
      return;
    }

    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || active === popup || !popup.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last || !popup.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      ref={popupRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={hasDescription ? descriptionId : undefined}
      tabIndex={-1}
      data-starting-style={starting ? "" : undefined}
      onKeyDown={handleKeyDown}
      {...props}
    />
  );
};

interface DialogTitleProps extends HTMLAttributes<HTMLHeadingElement> {}

const DialogTitle = (props: DialogTitleProps) => {
  const { titleId } = useDialogContext();
  return <h2 id={titleId} {...props} />;
};

interface DialogDescriptionProps extends HTMLAttributes<HTMLParagraphElement> {}

const DialogDescription = (props: DialogDescriptionProps) => {
  const { descriptionId, registerDescription } = useDialogContext();
  useLayoutEffect(() => registerDescription(), [registerDescription]);
  return <p id={descriptionId} {...props} />;
};

interface CloseRenderProps {
  onClick?: ((event: MouseEvent<HTMLElement>) => void) | undefined;
}

interface DialogCloseProps {
  render?: ReactElement<CloseRenderProps>;
  children?: ReactNode;
  className?: string;
}

const DialogClose = ({ render, children, className }: DialogCloseProps) => {
  const { onOpenChange } = useDialogContext();

  if (render) {
    return cloneElement(render, {
      onClick: (event: MouseEvent<HTMLElement>) => {
        render.props.onClick?.(event);
        if (!event.defaultPrevented) {
          onOpenChange?.(false);
        }
      },
    });
  }

  return (
    <button type="button" className={className} onClick={() => onOpenChange?.(false)}>
      {children}
    </button>
  );
};

export const Dialog = {
  Root: DialogRoot,
  Portal: DialogPortal,
  Backdrop: DialogBackdrop,
  Viewport: DialogViewport,
  Popup: DialogPopup,
  Title: DialogTitle,
  Description: DialogDescription,
  Close: DialogClose,
};
