import { MoonStar, SunMedium } from "lucide-react";
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

export const ThemeToggle = ({ theme, onChange }: ThemeToggleProps) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="outline" size="sm" aria-label="切换主题">
        {theme === "dark" ? <MoonStar className="size-4" /> : <SunMedium className="size-4" />}
        {theme}
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem onSelect={() => onChange("system")}>system</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onChange("light")}>light</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onChange("dark")}>dark</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);
