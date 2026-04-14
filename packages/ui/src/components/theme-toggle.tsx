import { Monitor, Moon, Sun } from "lucide-react";
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

export const ThemeToggle = ({ theme, onChange }: ThemeToggleProps) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="sm" className="h-7 w-7 px-0" aria-label="切换主题">
        <ThemeIcon theme={theme} />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem onSelect={() => onChange("light")}>
        <Sun className="mr-2 size-3.5" />
        light
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onChange("dark")}>
        <Moon className="mr-2 size-3.5" />
        dark
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onChange("system")}>
        <Monitor className="mr-2 size-3.5" />
        system
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);
