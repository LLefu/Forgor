import { useEffect, useState } from "react";
import { Plus, RotateCcw, X } from "lucide-react";
import { useUI } from "@/app/store";
import { FIXED_SHORTCUTS, keysOf, usedBy, type Shortcut } from "@/app/shortcuts";
import { applyHotkey } from "@/app/hotkey";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { comboFromEvent, fromGlobalCombo, isMac, isUsableCombo, normalizeCombo, reservedReason, shortcutLabel, toGlobalCombo } from "@/lib/keys";
import { cn } from "@/lib/utils";
import { useAllShortcuts } from "./all";
import { groupShortcuts, Keys } from "./ShortcutsHelp";

/**
 * Settings → Shortcuts: every shortcut (the app's and enabled plugins'), its
 * keys, and a way to change them: click a combo to replace it, + to add one,
 * × to remove one, ↺ for the defaults. Taken or reserved combos are refused.
 */
export function ShortcutsSettings({ desktop }: { desktop: boolean }) {
  const shortcuts = useAllShortcuts();
  const groups = groupShortcuts(shortcuts);
  return (
    <div className="space-y-6" data-testid="shortcuts-settings">
      <p className="text-xs text-muted-foreground">
        Click a shortcut to change it, then press the new keys (Esc cancels). Shortcuts the note editor uses itself, like {shortcutLabel("Mod+B")} for bold, stay
        the editor's while you're typing in a note.
      </p>
      <GlobalShortcut desktop={desktop} shortcuts={shortcuts} />
      {groups.map(({ group, items }) => (
        <section key={group}>
          <h3 className="mb-1 border-b pb-1 text-xs font-semibold text-foreground/80">{group}</h3>
          {items.map((s) => (
            <ShortcutRow key={s.id} shortcut={s} all={shortcuts} />
          ))}
          {FIXED_SHORTCUTS.filter((f) => f.group === group).map((f) => (
            <Line key={f.label} label={f.label}>
              <span className="text-xs text-muted-foreground">{f.display}</span>
            </Line>
          ))}
        </section>
      ))}
    </div>
  );
}

function Line({ label, children, error, testId }: { label: string; children: React.ReactNode; error?: string | null; testId?: string }) {
  return (
    <div className="py-1.5" data-testid={testId}>
      <div className="flex min-h-7 items-center justify-between gap-3">
        <span className="min-w-0 text-[13px]">{label}</span>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">{children}</div>
      </div>
      {error && (
        <p className="mt-0.5 text-right text-xs text-destructive" data-testid="shortcut-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** Why a combo can't be used for `id`, or null. */
function problem(combo: string, id: string, all: Shortcut[], overrides: Record<string, string[]>): string | null {
  if (!isUsableCombo(combo)) return `Hold ${isMac ? "⌘, ⌥ or ⌃" : "Ctrl or Alt"} with it (or use an F-key): plain keys are for typing.`;
  const reserved = reservedReason(combo);
  if (reserved) return `${shortcutLabel(combo)} can't be used: ${reserved}.`;
  const other = usedBy(combo, all, overrides, id);
  if (other) return `${shortcutLabel(combo)} is already used by “${other}”.`;
  return null;
}

function ShortcutRow({ shortcut, all }: { shortcut: Shortcut; all: Shortcut[] }) {
  const overrides = useUI((s) => s.settings.shortcuts);
  const update = useUI((s) => s.updateSetting);
  const keys = keysOf(shortcut, overrides);
  /** Which combo is being replaced (its index), keys.length = adding one, null = not recording. */
  const [recording, setRecording] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const changed = shortcut.id in overrides;

  const save = (next: string[]) => {
    const rest = { ...overrides };
    // Back to exactly the defaults: forget the override, so later default changes apply.
    if (next.length === shortcut.keys.length && next.every((k, i) => normalizeCombo(k) === normalizeCombo(shortcut.keys[i]))) delete rest[shortcut.id];
    else rest[shortcut.id] = next;
    void update("shortcuts", rest);
  };

  const onCombo = (combo: string) => {
    const at = recording!;
    const others = keys.filter((_, i) => i !== at);
    if (others.some((k) => normalizeCombo(k) === normalizeCombo(combo))) return setRecording(null);
    const why = problem(combo, shortcut.id, all, overrides);
    if (why) return setError(why);
    setError(null);
    setRecording(null);
    const next = [...keys];
    next.splice(at, 1, normalizeCombo(combo));
    save(next);
  };

  return (
    <Line label={shortcut.label} error={error} testId={`shortcut-${shortcut.id}`}>
      {keys.map((k, i) =>
        recording === i ? (
          <Recorder key={i} onCombo={onCombo} onCancel={() => (setRecording(null), setError(null))} />
        ) : (
          <span key={k} className="group/key relative">
            <button onClick={() => (setRecording(i), setError(null))} className="rounded hover:ring-1 hover:ring-ring" aria-label={`Change ${shortcutLabel(k)}`}>
              <Keys combo={k} />
            </button>
            <button
              onClick={() => save(keys.filter((_, j) => j !== i))}
              className="absolute -right-1.5 -top-1.5 hidden size-3.5 items-center justify-center rounded-full bg-foreground text-background group-hover/key:flex"
              aria-label={`Remove ${shortcutLabel(k)}`}
            >
              <X className="size-2.5" />
            </button>
          </span>
        ),
      )}
      {recording === keys.length ? (
        <Recorder onCombo={onCombo} onCancel={() => (setRecording(null), setError(null))} />
      ) : (
        <Tooltip content={keys.length ? "Add another" : "Add a shortcut"}>
          <button
            onClick={() => (setRecording(keys.length), setError(null))}
            className={cn("flex h-5 items-center rounded px-1 text-muted-foreground hover:bg-muted hover:text-foreground", !keys.length && "text-xs")}
            aria-label={`Add a shortcut for ${shortcut.label}`}
            data-testid="shortcut-add"
          >
            {keys.length ? <Plus className="size-3.5" /> : "None · add"}
          </button>
        </Tooltip>
      )}
      <Tooltip content="Back to the default">
        <button
          onClick={() => (save(shortcut.keys), setError(null))}
          className={cn("flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground", !changed && "invisible")}
          aria-label={`Reset ${shortcut.label}`}
          data-testid="shortcut-reset"
        >
          <RotateCcw className="size-3.5" />
        </button>
      </Tooltip>
    </Line>
  );
}

/** Waits for a key combo (capture phase, so nothing else reacts to it). Esc cancels, clicking elsewhere too. */
function Recorder({ onCombo, onCancel }: { onCombo: (combo: string) => void; onCancel: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) return onCancel();
      const combo = comboFromEvent(e);
      if (combo) onCombo(combo);
    };
    const onDown = () => onCancel();
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown);
    };
  }, [onCombo, onCancel]);
  return (
    <span className="inline-flex h-5 animate-pulse items-center rounded border border-primary bg-primary/10 px-1.5 text-[11px] text-primary" data-testid="shortcut-recording">
      Press keys…
    </span>
  );
}

/** The quick menu's shortcut, which works from any app (registered with the system by Rust). */
function GlobalShortcut({ desktop, shortcuts }: { desktop: boolean; shortcuts: Shortcut[] }) {
  const hotkey = useUI((s) => s.settings.hotkey);
  const overrides = useUI((s) => s.settings.shortcuts);
  const update = useUI((s) => s.updateSetting);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const combo = fromGlobalCombo(hotkey);

  const onCombo = async (next: string) => {
    const why = problem(next, "", shortcuts, overrides);
    const global = toGlobalCombo(next);
    if (why) return setError(why);
    if (!global) return setError("Use a letter, number, Space or F-key with it.");
    setRecording(false);
    try {
      await applyHotkey(global);
      await update("hotkey", global);
      setError(null);
    } catch (e) {
      setError(`Couldn't use ${shortcutLabel(next)}: ${String(e)}`);
      await applyHotkey(hotkey).catch(() => {});
    }
  };

  return (
    <section>
      <h3 className="mb-1 border-b pb-1 text-xs font-semibold text-foreground/80">From any app</h3>
      <Line label={desktop ? "Quick menu (works while Forgor is in the background)" : "Quick menu (desktop app only)"} error={error} testId="shortcut-global">
        {recording ? (
          <Recorder onCombo={(c) => void onCombo(c)} onCancel={() => (setRecording(false), setError(null))} />
        ) : (
          <Button variant="ghost" size="sm" className="h-6 px-1" disabled={!desktop} onClick={() => (setRecording(true), setError(null))} aria-label="Change the quick menu shortcut">
            <Keys combo={combo} />
          </Button>
        )}
      </Line>
    </section>
  );
}
