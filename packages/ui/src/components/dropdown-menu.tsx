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
        "z-50 min-w-40 rounded-xl border border-zinc-200 bg-white p-1 shadow-xl dark:border-zinc-800 dark:bg-zinc-950",
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
      "flex cursor-pointer select-none items-center rounded-lg px-3 py-2 text-sm outline-none hover:bg-zinc-100 dark:hover:bg-zinc-900",
      className,
    )}
    {...props}
  />
);
