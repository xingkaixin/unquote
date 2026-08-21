import { Languages } from "lucide-react";
import { useTranslation } from "../i18n/context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Button } from "./button";
import type { Locale, MessageKey } from "../i18n/i18n";

const localeOptions: { locale: Locale; label: MessageKey }[] = [
  { locale: "en", label: "locale.english" },
  { locale: "zh-CN", label: "locale.chinese" },
  { locale: "ja", label: "locale.japanese" },
];

export const LocaleToggle = () => {
  const { locale, setLocale, t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button size="sm" className="uq-icon-button h-7 w-7 px-0" aria-label={t("locale.toggle")}>
            <Languages className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={locale} onValueChange={setLocale}>
          {localeOptions.map(({ locale: optionLocale, label }) => (
            <DropdownMenuRadioItem key={optionLocale} value={optionLocale}>
              {t(label)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
