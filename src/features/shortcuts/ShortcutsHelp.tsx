import { Settings } from "lucide-react";
import { useUI } from "@/app/store";
import { FIXED_SHORTCUTS, keysOf, type Shortcut } from "@/app/shortcuts";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { fromGlobalCombo, shortcutLabel } from "@/lib/keys";
import { isTauri } from "@/platform/env";
import { useAllShortcuts } from "./all";

/** One combo as key caps. */
export function Keys({ combo, className }: { combo: string; className?: string }) {
  return (
    <kbd className={`inline-flex h-5 items-center rounded border bg-muted px-1.5 font-sans text-[11px] text-foreground/80 ${className ?? ""}`} data-testid="shortcut-keys">
      {shortcutLabel(combo)}
    </kbd>
  );
}

/** Everything grouped like Settings → Shortcuts: the app's groups in order, then each plugin's. */
export function groupShortcuts(shortcuts: Shortcut[]): { group: string; items: Shortcut[] }[] {
  const groups = new Map<string, Shortcut[]>();
  for (const s of shortcuts) groups.set(s.group, [...(groups.get(s.group) ?? []), s]);
  return [...groups.entries()].map(([group, items]) => ({ group, items }));
}

/** Mod+/: every shortcut at a glance, with a way to change them. */
export function ShortcutsHelp() {
  const open = useUI((s) => s.shortcutsHelp);
  const setOpen = useUI((s) => s.setShortcutsHelp);
  const overrides = useUI((s) => s.settings.shortcuts);
  const hotkey = useUI((s) => s.settings.hotkey);
  const shortcuts = useAllShortcuts();
  if (!open) return null;
  const groups = groupShortcuts(shortcuts);
  return (
    <Dialog open onOpenChange={setOpen}>
      <DialogContent title="Keyboard shortcuts" className="top-[6%] w-[640px]" data-testid="shortcuts-help">
        <div className="max-h-[70vh] columns-2 gap-6 overflow-y-auto pr-1 max-sm:columns-1">
          {groups.map(({ group, items }) => (
            <section key={group} className="mb-4 break-inside-avoid">
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{group}</h3>
              {items.map((s) => (
                <Line key={s.id} label={s.label}>
                  {keysOf(s, overrides).length ? keysOf(s, overrides).map((k) => <Keys key={k} combo={k} />) : <span className="text-[11px] text-muted-foreground">none</span>}
                </Line>
              ))}
              {FIXED_SHORTCUTS.filter((f) => f.group === group).map((f) => (
                <Line key={f.label} label={f.label}>
                  <span className="text-[11px] text-muted-foreground">{f.display}</span>
                </Line>
              ))}
            </section>
          ))}
          {isTauri() && (
            <section className="mb-4 break-inside-avoid">
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">From any app</h3>
              <Line label="Quick menu">
                <Keys combo={fromGlobalCombo(hotkey)} />
              </Line>
            </section>
          )}
        </div>
        <div className="mt-2 flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setOpen(false);
              useUI.getState().openSettings("shortcuts");
            }}
          >
            <Settings /> Change shortcuts
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-[13px]">
      <span className="min-w-0 truncate">{label}</span>
      <span className="flex shrink-0 items-center gap-1">{children}</span>
    </div>
  );
}
