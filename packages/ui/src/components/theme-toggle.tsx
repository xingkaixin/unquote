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
        <DropdownMenuItem
          onClick={() => onChange("light")}
          className={
            theme === "light"
              ? "bg-[var(--primary-soft)] font-bold text-accent shadow-[inset_3px_0_0_var(--color-accent)]"
              : ""
          }
        >
          <Sun className="mr-2 size-3.5" />
          {t("theme.light")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onChange("dark")}
          className={
            theme === "dark"
              ? "bg-[var(--primary-soft)] font-bold text-accent shadow-[inset_3px_0_0_var(--color-accent)]"
              : ""
          }
        >
          <Moon className="mr-2 size-3.5" />
          {t("theme.dark")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onChange("system")}
          className={
            theme === "system"
              ? "bg-[var(--primary-soft)] font-bold text-accent shadow-[inset_3px_0_0_var(--color-accent)]"
              : ""
          }
        >
          <Monitor className="mr-2 size-3.5" />
          {t("theme.system")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
