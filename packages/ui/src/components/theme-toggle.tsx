import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "../i18n/context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 w-7 px-0" aria-label={t("theme.toggle")}>
          <ThemeIcon theme={theme} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onChange("light")}>
          <Sun className="mr-2 size-3.5" />
          {t("theme.light")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onChange("dark")}>
          <Moon className="mr-2 size-3.5" />
          {t("theme.dark")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onChange("system")}>
          <Monitor className="mr-2 size-3.5" />
          {t("theme.system")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
