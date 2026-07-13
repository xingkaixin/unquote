import { Monitor, Moon, Sun } from "lucide-react";
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
      return <Moon className="size-4" />;
    case "light":
      return <Sun className="size-4" />;
    case "system":
      return <Monitor className="size-4" />;
  }
};

export const ThemeToggle = ({ theme, onChange }: ThemeToggleProps) => {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="uq-icon-button h-7 w-7 px-0"
            aria-label={t("theme.toggle")}
          >
            <ThemeIcon theme={theme} />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={theme} onValueChange={(value) => onChange(value)}>
          <DropdownMenuRadioItem value="light">
            <Sun className="mr-2 size-3.5" />
            {t("theme.light")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon className="mr-2 size-3.5" />
            {t("theme.dark")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor className="mr-2 size-3.5" />
            {t("theme.system")}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
