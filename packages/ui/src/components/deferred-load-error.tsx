import { TriangleAlert } from "lucide-react";
import { useTranslation } from "../i18n/context";
import { cn } from "../lib/utils";
import { Button } from "./button";

export interface DeferredLoadErrorProps {
  onRetry: () => void;
  className?: string;
}

export const DeferredLoadError = ({ onRetry, className }: DeferredLoadErrorProps) => {
  const { t } = useTranslation();

  return (
    <div
      role="alert"
      className={cn(
        "flex min-h-40 flex-1 items-center justify-center px-6 py-10 text-center",
        className,
      )}
    >
      <div className="flex max-w-md flex-col items-center gap-3">
        <TriangleAlert aria-hidden="true" className="size-4 text-warning" />
        <div className="space-y-1">
          <h2 className="m-0 text-[14px] font-semibold text-text-primary">
            {t("deferredLoad.title")}
          </h2>
          <p className="m-0 text-[12px] leading-5 text-text-secondary">
            {t("deferredLoad.description")}
          </p>
        </div>
        <Button type="button" size="sm" onClick={onRetry}>
          {t("deferredLoad.retry")}
        </Button>
      </div>
    </div>
  );
};
