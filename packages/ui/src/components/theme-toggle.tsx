import MonitorIcon from "@phosphor-icons/core/regular/monitor.svg?react";
import MoonIcon from "@phosphor-icons/core/regular/moon.svg?react";
import SunIcon from "@phosphor-icons/core/regular/sun.svg?react";
import { useTranslation } from "../i18n/context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Button } from "./button";

export interface ThemeToggleProps {
  theme: "system" | "light" | "dark";
  onChange: (theme: "system" | "light" | "dark") => void;
}

const ThemeIcon = ({ theme }: { theme: "system" | "light" | "dark" }) => {
  switch (theme) {
    case "dark":
      return <MoonIcon className="size-4" />;
    case "light":
      return <SunIcon className="size-4" />;
    case "system":
      return <MonitorIcon className="size-4" />;
  }
};

export const ThemeToggle = ({ theme, onChange }: ThemeToggleProps) => {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button size="sm" className="uq-icon-button h-7 w-7 px-0" aria-label={t("theme.toggle")}>
            <ThemeIcon theme={theme} />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={theme} onValueChange={(value) => onChange(value)}>
          <DropdownMenuRadioItem value="light">
            <SunIcon className="mr-2 size-3.5" />
            {t("theme.light")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <MoonIcon className="mr-2 size-3.5" />
            {t("theme.dark")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <MonitorIcon className="mr-2 size-3.5" />
            {t("theme.system")}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
