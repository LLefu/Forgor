import * as React from "react";
import { DropdownMenu as DM, ContextMenu as CM } from "radix-ui";
import { cn } from "@/lib/utils";

const contentCls = "z-50 min-w-[180px] rounded border bg-popover p-1 text-sm shadow-lg";
const itemCls =
  "flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 outline-none data-[highlighted]:bg-muted data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-muted-foreground";

export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;
export function DropdownMenuContent({ className, ...props }: React.ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content sideOffset={4} className={cn(contentCls, className)} {...props} />
    </DM.Portal>
  );
}
export function DropdownMenuItem({
  className,
  destructive,
  ...props
}: React.ComponentProps<typeof DM.Item> & { destructive?: boolean }) {
  return <DM.Item className={cn(itemCls, destructive && "text-destructive", className)} {...props} />;
}
export function DropdownMenuSeparator() {
  return <DM.Separator className="my-1 h-px bg-border" />;
}

export const ContextMenu = CM.Root;
export const ContextMenuTrigger = CM.Trigger;
export function ContextMenuContent({ className, ...props }: React.ComponentProps<typeof CM.Content>) {
  return (
    <CM.Portal>
      <CM.Content className={cn(contentCls, className)} {...props} />
    </CM.Portal>
  );
}
export function ContextMenuItem({
  className,
  destructive,
  ...props
}: React.ComponentProps<typeof CM.Item> & { destructive?: boolean }) {
  return <CM.Item className={cn(itemCls, destructive && "text-destructive", className)} {...props} />;
}
export function ContextMenuSeparator() {
  return <CM.Separator className="my-1 h-px bg-border" />;
}

export const ContextMenuSub = CM.Sub;
export function ContextMenuSubTrigger({ className, children, ...props }: React.ComponentProps<typeof CM.SubTrigger>) {
  return (
    <CM.SubTrigger className={cn(itemCls, "data-[state=open]:bg-muted", className)} {...props}>
      {children}
      <span className="ml-auto pl-4 text-muted-foreground">›</span>
    </CM.SubTrigger>
  );
}
export function ContextMenuSubContent({ className, ...props }: React.ComponentProps<typeof CM.SubContent>) {
  return (
    <CM.Portal>
      <CM.SubContent sideOffset={4} className={cn(contentCls, className)} {...props} />
    </CM.Portal>
  );
}

/** Unstyled context-menu item, for wrapping custom controls (e.g. color swatches) via `asChild`. */
export const ContextMenuItemRaw = CM.Item;
