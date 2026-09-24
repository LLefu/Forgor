import * as React from "react";
import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  className,
  children,
  title,
  ...props
}: React.ComponentProps<typeof D.Content> & { title: string }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/40" />
      <D.Content
        className={cn(
          "fixed left-1/2 top-[12%] z-50 w-[520px] max-w-[calc(100vw-32px)] -translate-x-1/2 rounded border bg-popover p-4 shadow-xl outline-none",
          className,
        )}
        aria-describedby={undefined}
        {...props}
      >
        <div className="mb-3 flex items-center justify-between">
          <D.Title className="text-sm font-semibold">{title}</D.Title>
          <D.Close className="rounded-sm p-1 text-muted-foreground hover:bg-muted" aria-label="Close">
            <X className="size-4" />
          </D.Close>
        </div>
        {children}
      </D.Content>
    </D.Portal>
  );
}
