import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

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

Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn(),
  },
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
});
