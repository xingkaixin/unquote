import "@testing-library/jest-dom/vitest";
import { toast } from "sonner";
import { afterEach, vi } from "vitest";

afterEach(() => {
  toast.dismiss();
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("dark"),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: {
    writeText: vi.fn(),
  },
});

const storage = new Map<string, string>();
const localStorageStub = {
  get length() {
    return storage.size;
  },
  clear: () => storage.clear(),
  getItem: (key: string) => storage.get(key) ?? null,
  key: (index: number) => Array.from(storage.keys())[index] ?? null,
  removeItem: (key: string) => {
    storage.delete(key);
  },
  setItem: (key: string, value: string) => {
    storage.set(key, value);
  },
};

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: localStorageStub,
});

Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: localStorageStub,
});

Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn(),
});

// jsdom has no pointer capture; Base UI's slider calls it on pointerdown.
for (const method of ["setPointerCapture", "releasePointerCapture"] as const) {
  Object.defineProperty(Element.prototype, method, {
    configurable: true,
    value: vi.fn(),
  });
}
Object.defineProperty(Element.prototype, "hasPointerCapture", {
  configurable: true,
  value: vi.fn(() => false),
});

Object.defineProperty(window, "scrollTo", {
  configurable: true,
  value: vi.fn(),
});

Object.assign(globalThis, {
  IntersectionObserver: class {
    constructor(..._args: unknown[]) {}
    disconnect() {}
    observe() {}
    unobserve() {}
    takeRecords() {
      return [];
    }
  },
  ResizeObserver: class {
    disconnect() {}
    observe() {}
    unobserve() {}
  },
});

Object.assign(window, { ResizeObserver: globalThis.ResizeObserver });
