import { useEffect } from "react";
import { create } from "zustand";
import { AlertCircle, Bell, X } from "lucide-react";

/**
 * Minimal toasts. Errors: any unhandled promise rejection (e.g. a failed file
 * operation from a menu action) shows up here instead of failing silently.
 * Notices: a notification shown inside the app (app/notifications.ts, when the
 * system hides its banner because Forgor is in front).
 */
interface Toast {
  id: number;
  message: string;
  kind: "error" | "notice";
  title?: string;
}

const useToasts = create<{ toasts: Toast[] }>(() => ({ toasts: [] }));
let nextId = 1;

export function showError(error: unknown, context?: string) {
  const raw = String((error as Error)?.message ?? error);
  const message = context ? `${context}: ${raw}` : raw;
  const id = nextId++;
  useToasts.setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, kind: "error" }] }));
  setTimeout(() => dismiss(id), 8000);
  console.error(context ?? "Error", error);
}

/** A notification inside the app (title + one line). */
export function showNotice(title: string, message: string) {
  const id = nextId++;
  useToasts.setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, title, message, kind: "notice" }] }));
  setTimeout(() => dismiss(id), 6000);
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
        <div
          key={t.id}
          role={t.kind === "error" ? "alert" : "status"}
          className={`flex items-start gap-2 rounded border bg-popover p-3 text-sm shadow-lg ${t.kind === "error" ? "border-destructive/40" : "border-primary/30"}`}
          data-testid={t.kind === "notice" ? "notice" : undefined}
        >
          {t.kind === "error" ? <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" /> : <Bell className="mt-0.5 size-4 shrink-0 text-primary" />}
          <div className="min-w-0 flex-1 break-words">
            {t.title && <p className="font-medium">{t.title}</p>}
            <p className={t.title ? "text-muted-foreground" : undefined}>{t.message}</p>
          </div>
          <button onClick={() => dismiss(t.id)} className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted" aria-label="Dismiss">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
