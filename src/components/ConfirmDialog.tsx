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

export interface Choice {
  id: string;
  label: string;
  destructive?: boolean;
}

interface ChooseOptions {
  title: string;
  message?: string;
  /** Buttons from left to right; the last one has the focus. Cancel is added before them. */
  choices: Choice[];
  cancelLabel?: string;
}

interface ConfirmState {
  request: (ChooseOptions & { resolve: (choice: string | null) => void }) | null;
}

const useConfirm = create<ConfirmState>(() => ({ request: null }));

export function confirmDialog({ confirmLabel, destructive, ...options }: ConfirmOptions): Promise<boolean> {
  return chooseDialog({ ...options, choices: [{ id: "ok", label: confirmLabel ?? "OK", destructive }] }).then((c) => c === "ok");
}

/** Like confirmDialog with more than one way to go on: resolves with the chosen id, or null when cancelled. */
export function chooseDialog(options: ChooseOptions): Promise<string | null> {
  return new Promise((resolve) => {
    useConfirm.getState().request?.resolve(null); // only one at a time
    useConfirm.setState({ request: { ...options, resolve } });
  });
}

/** Mount once per window. */
export function ConfirmDialogHost() {
  const request = useConfirm((s) => s.request);
  const close = (choice: string | null) => {
    request?.resolve(choice);
    useConfirm.setState({ request: null });
  };
  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && close(null)}>
      {request && (
        <DialogContent title={request.title} className={request.choices.length > 1 ? "w-[520px]" : "w-[420px]"} data-testid="confirm-dialog">
          {request.message && <p className="whitespace-pre-line text-sm text-muted-foreground">{request.message}</p>}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => close(null)}>
              {request.cancelLabel ?? "Cancel"}
            </Button>
            {request.choices.map((c, i) => (
              <Button
                key={c.id}
                variant={c.destructive ? "destructive" : i === request.choices.length - 1 ? "default" : "outline"}
                onClick={() => close(c.id)}
                autoFocus={i === request.choices.length - 1}
                data-testid={`choice-${c.id}`}
              >
                {c.label}
              </Button>
            ))}
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
