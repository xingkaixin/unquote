import { useEffect, useRef } from "react";

export const isTextEditingElement = (element: Element | null) =>
  element instanceof HTMLInputElement ||
  element instanceof HTMLTextAreaElement ||
  element instanceof HTMLSelectElement ||
  (element instanceof HTMLElement && element.isContentEditable);

export interface GlobalShortcut {
  matches: (event: KeyboardEvent) => boolean;
  // Return `false` to signal the shortcut isn't consuming this event (e.g. no
  // selection to copy) so the browser's default action still runs. Any other
  // return value (including void) consumes the event via preventDefault.
  handler: (event: KeyboardEvent) => boolean | void;
  // Whether the shortcut still fires while an <input>/<textarea>/<select>/
  // contenteditable element has focus. Defaults to false.
  allowInTextEditing?: boolean;
}

// A single window keydown listener dispatching to a command table, instead of
// one effect per shortcut. Shortcuts are read from a ref so callers can pass a
// fresh array every render without tearing down and re-adding the listener.
export const useGlobalShortcuts = (shortcuts: GlobalShortcut[]): void => {
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      for (const shortcut of shortcutsRef.current) {
        if (!shortcut.matches(event)) {
          continue;
        }
        if (!shortcut.allowInTextEditing && isTextEditingElement(document.activeElement)) {
          continue;
        }

        const consumed = shortcut.handler(event);
        if (consumed !== false) {
          event.preventDefault();
        }
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
};
