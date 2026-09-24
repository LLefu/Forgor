import { create } from "zustand";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * In-app replacement for window.confirm(). The native one is not supported by
 * the macOS webview (it silently returns false), so every confirmation goes
 * through this dialog instead.
 *
 *   if (await confirmDialog({ title: "Move to trash?", confirmLabel: "Move to trash", destructive: true })) …
 */
interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface ConfirmState {
  request: (ConfirmOptions & { resolve: (ok: boolean) => void }) | null;
}

const useConfirm = create<ConfirmState>(() => ({ request: null }));

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirm.getState().request?.resolve(false); // only one at a time
    useConfirm.setState({ request: { ...options, resolve } });
  });
}

/** Mount once per window. */
export function ConfirmDialogHost() {
  const request = useConfirm((s) => s.request);
  const close = (ok: boolean) => {
    request?.resolve(ok);
    useConfirm.setState({ request: null });
  };
  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && close(false)}>
      {request && (
        <DialogContent title={request.title} className="w-[420px]" data-testid="confirm-dialog">
          {request.message && <p className="whitespace-pre-line text-sm text-muted-foreground">{request.message}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => close(false)}>
              {request.cancelLabel ?? "Cancel"}
            </Button>
            <Button variant={request.destructive ? "destructive" : "default"} onClick={() => close(true)} autoFocus>
              {request.confirmLabel ?? "OK"}
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
