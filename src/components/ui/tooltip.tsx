import * as React from "react";
import { Tooltip as T } from "radix-ui";

export const TooltipProvider = T.Provider;

export function Tooltip({ content, children }: { content: React.ReactNode; children: React.ReactNode }) {
  return (
    <T.Root delayDuration={400}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          sideOffset={4}
          className="z-50 max-w-xs rounded-sm bg-foreground px-2 py-1 text-xs text-background shadow"
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
