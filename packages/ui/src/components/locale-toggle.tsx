import { Languages } from "lucide-react";
import { useTranslation } from "../i18n/context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Button } from "./button";
import type { Locale } from "../i18n/i18n";

const labels: Record<Locale, string> = {
  en: "English",
  "zh-CN": "中文",
};

export const LocaleToggle = () => {
  const { locale, setLocale, t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="uq-icon-button h-7 w-7 px-0"
            aria-label={t("locale.toggle")}
          >
            <Languages className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        {(Object.entries(labels) as [Locale, string][]).map(([key, label]) => (
          <DropdownMenuItem
            key={key}
            onClick={() => setLocale(key)}
            className={key === locale ? "font-semibold" : ""}
          >
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
