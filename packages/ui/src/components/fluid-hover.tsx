import { useEffect, useRef, type ReactNode } from "react";
import { animate } from "framer-motion/dom/mini";
import { spring } from "framer-motion";
import { prefersReducedMotion } from "../lib/motion-preference";
import { cn } from "../lib/utils";

// Adapted from https://www.fluidfunctionalism.com/docs/fluid-hover for fixed
// Base UI menus and tabs. Clicks and keyboard focus remain with the primitives.
const travel = { type: spring, duration: 0.08, bounce: 0 };

const itemSelector = "[data-fluid-hover-item]";

export function FluidHover({ children, axis = "y" }: { children: ReactNode; axis?: "x" | "y" }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current!;
    const highlight = highlightRef.current!;
    let items: HTMLElement[] = [];
    let active: HTMLElement | null = null;
    let frame: number | undefined;
    let animation: ReturnType<typeof animate> | undefined;
    let point: { x: number; y: number } | null = null;
    const motionQuery = matchMedia("(prefers-reduced-motion: reduce)");

    function clear(event?: Event) {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      point = null;
      if (!active) return;
      active.removeAttribute("data-fluid-hover-active");
      active = null;
      container.removeAttribute("data-hovering");
      animation?.stop();
      animation = animate(
        highlight,
        { opacity: 0 },
        {
          duration: event?.type === "keydown" ? 0 : 0.06,
        },
      );
    }

    function pick(snap = false) {
      if (!point) return;
      let nearest: HTMLElement | null = null;
      let distance = Infinity;
      const horizontal = axis === "x";
      for (const item of items) {
        if (item.matches(":disabled, [aria-disabled=true], [data-disabled]")) continue;
        const rect = item.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        const start = horizontal ? rect.left : rect.top;
        const size = horizontal ? rect.width : rect.height;
        const position = horizontal ? point.x : point.y;
        if (position >= start && position <= start + size) {
          nearest = item;
          break;
        }
        const nextDistance = Math.abs(position - start - size / 2);
        if (nextDistance < distance) {
          nearest = item;
          distance = nextDistance;
        }
      }
      if (!nearest) {
        clear();
        return;
      }
      if (nearest === active && !snap) return;
      const first = active === null;
      active?.removeAttribute("data-fluid-hover-active");
      active = nearest;
      active.setAttribute("data-fluid-hover-active", "");
      container.setAttribute("data-hovering", "");

      // Offset geometry stays in layout coordinates while the popup scales in.
      let left = active.offsetLeft;
      let top = active.offsetTop;
      let parent = active.offsetParent as HTMLElement | null;
      while (parent && parent !== container && container.contains(parent)) {
        left += parent.offsetLeft + parent.clientLeft;
        top += parent.offsetTop + parent.clientTop;
        parent = parent.offsetParent as HTMLElement | null;
      }
      const target = {
        transform: `translate(${left}px, ${top}px)`,
        width: `${active.offsetWidth}px`,
        height: `${active.offsetHeight}px`,
      };
      animation?.stop();
      if (first || snap || prefersReducedMotion()) {
        Object.assign(highlight.style, target);
        animation = animate(highlight, { opacity: 1 }, { duration: 0.08 });
      } else {
        animation = animate(
          highlight,
          { ...target, opacity: 1 },
          {
            ...travel,
            opacity: { duration: 0.08 },
          },
        );
      }
    }

    function move(event: PointerEvent) {
      if (event.pointerType !== "mouse") return;
      point = { x: event.clientX, y: event.clientY };
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = undefined;
        pick();
      });
    }

    function press(event: PointerEvent) {
      if (event.pointerType !== "mouse") clear();
    }

    function refresh() {
      observer.disconnect();
      items = Array.from(container.querySelectorAll<HTMLElement>(itemSelector));
      observer.observe(container);
      for (const item of items) observer.observe(item);
      if (active && !items.includes(active)) clear();
      else pick(true);
    }

    const observer = new ResizeObserver(() => pick(true));
    const mutations = new MutationObserver(refresh);
    refresh();
    mutations.observe(container, { childList: true, subtree: true });
    container.addEventListener("pointermove", move);
    container.addEventListener("pointerleave", clear);
    container.addEventListener("pointercancel", clear);
    container.addEventListener("pointerdown", press);
    container.addEventListener("keydown", clear, true);
    container.addEventListener("scroll", clear, true);
    motionQuery.addEventListener("change", clear);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      animation?.stop();
      active?.removeAttribute("data-fluid-hover-active");
      container.removeAttribute("data-hovering");
      observer.disconnect();
      mutations.disconnect();
      container.removeEventListener("pointermove", move);
      container.removeEventListener("pointerleave", clear);
      container.removeEventListener("pointercancel", clear);
      container.removeEventListener("pointerdown", press);
      container.removeEventListener("keydown", clear, true);
      container.removeEventListener("scroll", clear, true);
      motionQuery.removeEventListener("change", clear);
    };
  }, [axis]);

  return (
    <div
      ref={containerRef}
      className={cn("uq-fluid-hover", axis === "x" && "flex h-full items-center")}
    >
      <div ref={highlightRef} data-slot="fluid-hover-highlight" aria-hidden="true" />
      {children}
    </div>
  );
}
