import * as React from "react";
import { Popover as P } from "radix-ui";
import { cn } from "@/lib/utils";

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverAnchor = P.Anchor;

/**
 * Inside a dialog, popovers render into the dialog: the dialog blocks scrolling
 * (wheel events) everywhere outside itself, which made long lists unscrollable.
 */
export const PortalContainerContext = React.createContext<HTMLElement | null>(null);

export function PopoverContent({ className, align = "start", ...props }: React.ComponentProps<typeof P.Content>) {
  const container = React.useContext(PortalContainerContext);
  return (
    <P.Portal container={container ?? undefined}>
      <P.Content
        align={align}
        sideOffset={4}
        className={cn("z-50 rounded border bg-popover p-2 text-sm shadow-lg outline-none", className)}
        {...props}
      />
    </P.Portal>
  );
}
