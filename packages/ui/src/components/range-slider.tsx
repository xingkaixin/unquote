import { useRef } from "react";
import type { ChangeEvent, KeyboardEvent, PointerEvent } from "react";

export interface RangeSliderProps {
  value: readonly [number, number];
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onValueChange: (value: readonly number[]) => void;
  getAriaLabel: (index: number) => string;
  getAriaValueText?: ((index: number) => string) | undefined;
}

const clamp = (value: number, lower: number, upper: number) =>
  Math.min(upper, Math.max(lower, value));

const toPercent = (value: number, min: number, max: number) => {
  const span = max - min;
  if (span > 0 && Number.isFinite(span)) {
    return clamp(((value - min) / span) * 100, 0, 100);
  }

  const halfMin = min / 2;
  const halfSpan = max / 2 - halfMin;
  if (halfSpan > 0 && Number.isFinite(halfSpan)) {
    return clamp(((value / 2 - halfMin) / halfSpan) * 100, 0, 100);
  }

  return 0;
};

const snapToStep = (raw: number, min: number, max: number, step: number) => {
  if (!(step > 0) || !Number.isFinite(step)) {
    return clamp(raw, min, max);
  }

  const offset = raw - min;
  if (!Number.isFinite(offset)) {
    return clamp(raw, min, max);
  }

  const snapped = min + Math.round(offset / step) * step;
  return clamp(snapped, min, max);
};

/**
 * A dual-thumb slider for selecting a bounded range. Thumbs cannot cross, so
 * one change event only ever moves one end of the range.
 */
export const RangeSlider = ({
  value,
  min,
  max,
  step,
  disabled = false,
  onValueChange,
  getAriaLabel,
  getAriaValueText,
}: RangeSliderProps) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const inputRefs = useRef<[HTMLInputElement | null, HTMLInputElement | null]>([null, null]);
  const activeThumbRef = useRef<0 | 1 | null>(null);

  const commitThumbValue = (index: 0 | 1, candidate: number) => {
    const nextValue =
      index === 0 ? clamp(candidate, min, value[1]) : clamp(candidate, value[0], max);
    if (index === 0) {
      onValueChange([nextValue, value[1]]);
    } else {
      onValueChange([value[0], nextValue]);
    }
  };

  const valueFromClientX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) {
      return null;
    }

    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    const span = max - min;
    const raw = Number.isFinite(span) ? min + ratio * span : min + ratio * (max / 2 - min / 2) * 2;
    return snapToStep(raw, min, max, step);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) {
      return;
    }

    const raw = valueFromClientX(event.clientX);
    let thumbIndex: 0 | 1;
    if (event.target === inputRefs.current[0]) {
      thumbIndex = 0;
    } else if (event.target === inputRefs.current[1]) {
      thumbIndex = 1;
    } else if (raw !== null) {
      const distStart = Math.abs(raw - value[0]);
      const distEnd = Math.abs(raw - value[1]);
      if (distStart === distEnd) {
        thumbIndex = raw > value[1] ? 1 : 0;
      } else {
        thumbIndex = distStart < distEnd ? 0 : 1;
      }
    } else {
      return;
    }

    activeThumbRef.current = thumbIndex;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    inputRefs.current[thumbIndex]?.focus({ preventScroll: true });

    if (
      raw !== null &&
      event.target !== inputRefs.current[0] &&
      event.target !== inputRefs.current[1]
    ) {
      commitThumbValue(thumbIndex, raw);
    }
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const thumbIndex = activeThumbRef.current;
    if (disabled || thumbIndex === null) {
      return;
    }

    const next = valueFromClientX(event.clientX);
    if (next !== null) {
      commitThumbValue(thumbIndex, next);
    }
  };

  const handlePointerUp = () => {
    activeThumbRef.current = null;
  };

  const handleInputChange = (index: 0 | 1) => (event: ChangeEvent<HTMLInputElement>) => {
    if (disabled) {
      return;
    }

    const parsed = Number(event.currentTarget.value);
    if (!Number.isFinite(parsed)) {
      return;
    }

    commitThumbValue(index, parsed);
  };

  const handleInputKeyDown = (index: 0 | 1) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) {
      return;
    }

    const current = value[index];
    let candidate: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        candidate = current + step;
        break;
      case "ArrowLeft":
      case "ArrowDown":
        candidate = current - step;
        break;
      case "PageUp":
        candidate = current + step * 10;
        break;
      case "PageDown":
        candidate = current - step * 10;
        break;
      case "Home":
        candidate = index === 0 ? min : value[0];
        break;
      case "End":
        candidate = index === 0 ? value[1] : max;
        break;
      default:
        return;
    }

    event.preventDefault();
    commitThumbValue(index, candidate);
  };

  const startPercent = toPercent(value[0], min, max);
  const endPercent = toPercent(value[1], min, max);
  const thumbs: readonly [0, 1] = [0, 1];

  return (
    <div className="w-full" data-disabled={disabled ? "" : undefined}>
      <div
        className="flex h-5 w-full touch-none items-center select-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div ref={trackRef} className="relative h-1 w-full rounded-full bg-border-medium">
          <div
            className="absolute top-0 bottom-0 rounded-full bg-accent"
            style={{
              left: `${startPercent}%`,
              width: `${Math.max(0, endPercent - startPercent)}%`,
            }}
          />
          {thumbs.map((index) => {
            const percent = index === 0 ? startPercent : endPercent;
            return (
              <div
                key={index}
                data-disabled={disabled ? "" : undefined}
                style={{ left: `${percent}%` }}
                className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-surface-100 bg-accent outline-none has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent data-[disabled]:opacity-40"
              >
                <input
                  ref={(node) => {
                    inputRefs.current[index] = node;
                  }}
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={value[index]}
                  disabled={disabled}
                  aria-label={getAriaLabel(index)}
                  aria-valuetext={getAriaValueText ? getAriaValueText(index) : undefined}
                  onChange={handleInputChange(index)}
                  onKeyDown={handleInputKeyDown(index)}
                  className="absolute inset-0 m-0 size-full cursor-pointer opacity-0 disabled:cursor-default"
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
