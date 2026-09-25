import { useEffect } from "react";
import { create } from "zustand";
import { AlertCircle, X } from "lucide-react";

/**
 * Minimal error toasts. Any unhandled promise rejection (e.g. a failed file
 * operation from a menu action) shows up here instead of failing silently.
 */
interface Toast {
  id: number;
  message: string;
}

const useToasts = create<{ toasts: Toast[] }>(() => ({ toasts: [] }));
let nextId = 1;

export function showError(error: unknown, context?: string) {
  const raw = String((error as Error)?.message ?? error);
  const message = context ? `${context}: ${raw}` : raw;
  const id = nextId++;
  useToasts.setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, message }] }));
  setTimeout(() => dismiss(id), 8000);
  console.error(context ?? "Error", error);
}

function dismiss(id: number) {
  useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

/** Mount once per window. */
export function ToastHost() {
  const toasts = useToasts((s) => s.toasts);

  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => showError(e.reason, "Something went wrong");
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);

  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex w-[360px] flex-col gap-2" data-testid="toasts">
      {toasts.map((t) => (
        <div key={t.id} role="alert" className="flex items-start gap-2 rounded border border-destructive/40 bg-popover p-3 text-sm shadow-lg">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p className="min-w-0 flex-1 break-words">{t.message}</p>
          <button onClick={() => dismiss(t.id)} className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted" aria-label="Dismiss">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
