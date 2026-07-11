import { Languages } from "lucide-react";
import { useTranslation } from "../i18n/context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Button } from "./button";
import type { Locale, MessageKey } from "../i18n/i18n";

const localeOptions: { locale: Locale; label: MessageKey }[] = [
  { locale: "en", label: "locale.english" },
  { locale: "zh-CN", label: "locale.chinese" },
];

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
        {localeOptions.map(({ locale: optionLocale, label }) => (
          <DropdownMenuItem
            key={optionLocale}
            onClick={() => setLocale(optionLocale)}
            className={optionLocale === locale ? "font-semibold" : ""}
          >
            {t(label)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
