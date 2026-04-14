import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "../lib/utils";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuContent = ({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      sideOffset={8}
      className={cn(
        "z-50 min-w-40 rounded-md border border-border bg-surface-100 p-1 shadow-lg",
        className,
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
);
export const DropdownMenuItem = ({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item>) => (
  <DropdownMenuPrimitive.Item
    className={cn(
      "flex cursor-pointer select-none items-center rounded-sm px-3 py-2 text-[13px] text-text-primary outline-none hover:bg-surface-300",
      className,
    )}
    {...props}
  />
);
