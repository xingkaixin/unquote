import { ChevronDown, ChevronUp, ScanSearch } from "lucide-react";
import { useTranslation } from "../i18n/context";
import { Button } from "./button";

interface PathJumpBarProps {
  value: string;
  error: string | null;
  matchCount: number;
  currentIndex: number;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onPrev: () => void;
  onNext: () => void;
}

export const PathJumpBar = ({
  value,
  error,
  matchCount,
  currentIndex,
  onChange,
  onSubmit,
  onPrev,
  onNext,
}: PathJumpBarProps) => {
  const { t } = useTranslation();
  const showNav = value.length > 0 && matchCount > 0;

  return (
    <form
      className="min-w-0 flex-1"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div
        className={`flex min-w-0 items-center gap-1.5 rounded-md border bg-surface-100 px-2 py-1 ${
          error ? "border-error/70" : "border-border"
        }`}
      >
        <ScanSearch className="size-3.5 shrink-0 text-text-muted" />
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t("path.placeholder")}
          aria-invalid={Boolean(error)}
          className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-text-primary outline-none placeholder:font-sans placeholder:text-text-muted"
        />
        {showNav ? (
          <>
            <span className="shrink-0 font-mono text-[11px] text-text-muted">
              {currentIndex + 1}/{matchCount}
            </span>
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-5 w-5 px-0"
                onClick={onPrev}
                aria-label={t("search.prev")}
              >
                <ChevronUp className="size-3" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-5 w-5 px-0"
                onClick={onNext}
                aria-label={t("search.next")}
              >
                <ChevronDown className="size-3" />
              </Button>
            </div>
          </>
        ) : null}
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          className="h-5 w-5 shrink-0 px-0"
          aria-label={t("path.jump")}
        >
          <ScanSearch className="size-3" />
        </Button>
      </div>
      {error ? <div className="mt-1 text-[11px] text-error">{error}</div> : null}
    </form>
  );
};
