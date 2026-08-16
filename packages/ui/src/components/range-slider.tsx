import { Slider } from "@base-ui/react/slider";

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
}: RangeSliderProps) => (
  <Slider.Root
    value={value as [number, number]}
    min={min}
    max={max}
    step={step}
    disabled={disabled}
    thumbCollisionBehavior="none"
    onValueChange={(next) => onValueChange(next)}
    className="w-full"
  >
    <Slider.Control className="flex h-5 w-full touch-none items-center select-none">
      <Slider.Track className="h-1 w-full rounded-full bg-border-medium">
        <Slider.Indicator className="rounded-full bg-accent" />
        {[0, 1].map((index) => (
          <Slider.Thumb
            key={index}
            index={index}
            getAriaLabel={getAriaLabel}
            {...(getAriaValueText
              ? {
                  getAriaValueText: (_formatted: string, _value: number, thumbIndex: number) =>
                    getAriaValueText(thumbIndex),
                }
              : {})}
            className="size-3 rounded-full border border-surface-100 bg-accent outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent data-[disabled]:opacity-40"
          />
        ))}
      </Slider.Track>
    </Slider.Control>
  </Slider.Root>
);
