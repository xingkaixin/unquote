import { Menu } from "@base-ui/react/menu";
import { cn } from "../lib/utils";

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuRadioGroup = Menu.RadioGroup;
export const DropdownMenuContent = ({
  className,
  align,
  ...props
}: React.ComponentProps<typeof Menu.Popup> &
  Pick<React.ComponentProps<typeof Menu.Positioner>, "align">) => (
  <Menu.Portal>
    <Menu.Positioner align={align} sideOffset={8} className="z-50 outline-none">
      <Menu.Popup
        className={cn(
          "uq-dropdown-popup min-w-40 rounded-xl border border-border-medium bg-surface-100 p-1 shadow-[var(--shadow-panel)]",
          className,
        )}
        {...props}
      />
    </Menu.Positioner>
  </Menu.Portal>
);
const itemClassName =
  "flex cursor-pointer select-none items-center rounded-none px-3 py-2 font-mono text-ui-11 uppercase tracking-[0.08em] text-text-secondary outline-none hover:bg-surface-200 hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent data-highlighted:bg-surface-200 data-highlighted:text-text-primary";

export const DropdownMenuItem = ({
  className,
  ...props
}: React.ComponentProps<typeof Menu.Item>) => (
  <Menu.Item className={cn(itemClassName, className)} {...props} />
);

export const DropdownMenuRadioItem = ({
  className,
  ...props
}: React.ComponentProps<typeof Menu.RadioItem>) => (
  <Menu.RadioItem className={cn(itemClassName, className)} {...props} />
);
