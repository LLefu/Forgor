import { useState } from "react";
import { FolderOpen, RefreshCw, CheckCircle2, Loader2, Download, RotateCw, Check, History } from "lucide-react";
import { VersionHistoryDialog } from "./VersionHistoryDialog";
import { ACCENTS } from "@/lib/accents";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { useUpdates } from "@/app/updates";
import { confirmDialog } from "@/components/ConfirmDialog";
import { useUI } from "@/app/store";
import { PageHeader } from "@/features/todos/TodosPage";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ctx } from "@/data/context";
import type { Platform } from "@/platform/types";
import { chooseVault } from "@/app/boot";
import { isMac } from "@/lib/keys";
import { applyHotkey } from "@/app/hotkey";

export function SettingsView({ platform }: { platform: Platform }) {
  const settings = useUI((s) => s.settings);
  const update = useUI((s) => s.updateSetting);
  const [hotkey, setHotkey] = useState(settings.hotkey);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-2xl pb-16">
      <PageHeader title="Settings" />
      <div className="space-y-6 px-8">
        <UpdatesRow desktop={platform.kind === "tauri"} />

        <Row label="Notes folder" hint="Your notes are plain .md files in this folder. You can open them in any editor.">
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 text-xs">{ctx().vault.rootLabel}</code>
            {platform.kind === "tauri" && (
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  const picked = await platform.pickVaultFolder();
                  const ok =
                    !!picked &&
                    (await confirmDialog({
                      title: "Switch notes folder?",
                      message: `New folder:\n${picked}\n\nYour todos stay. Links to notes in the old folder are hidden until you switch back.`,
                      confirmLabel: "Switch folder",
                    }));
                  if (picked && ok) {
                    await chooseVault(platform, picked);
                    await update("vaultPath", picked);
                  }
                }}
              >
                <FolderOpen /> Change…
              </Button>
            )}
          </div>
        </Row>

        <Row label="Theme">
          <Select
            value={settings.theme}
            onChange={(v) => update("theme", v)}
            options={[
              { value: "system", label: "Follow system" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </Row>

        <Row label="Highlight color" hint="Used for buttons, selections, links and the today marker.">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Highlight color" data-testid="accent-picker">
            {ACCENTS.map((a) => {
              const selected = settings.accent === a.id;
              return (
                <Tooltip key={a.id} content={a.label}>
                  <button
                    role="radio"
                    aria-checked={selected}
                    aria-label={a.label}
                    onClick={() => update("accent", a.id)}
                    className={cn(
                      "flex size-7 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition-transform hover:scale-110",
                      selected && "ring-2 ring-foreground/60",
                    )}
                    style={{ background: `light-dark(${a.light}, ${a.dark})` }}
                  >
                    {selected && <Check className="size-4" style={{ color: `light-dark(#fff, ${a.darkForeground ?? "#fff"})` }} strokeWidth={3} />}
                  </button>
                </Tooltip>
              );
            })}
          </div>
        </Row>

        <Row label="Archive completed todos after" hint="Completed todos stay visible for this long, then move to the Archive.">
          <Select<string>
            value={String(settings.archiveAfterDays)}
            onChange={(v) => update("archiveAfterDays", Number(v))}
            options={[1, 3, 7, 14, 30, 90].map((d) => ({ value: String(d), label: `${d} day${d === 1 ? "" : "s"}` }))}
          />
        </Row>

        <Row label="Upcoming shows">
          <Select<string>
            value={String(settings.upcomingDays)}
            onChange={(v) => update("upcomingDays", Number(v))}
            options={[7, 14, 30, 60].map((d) => ({ value: String(d), label: `Next ${d} days` }))}
          />
        </Row>

        <Row
          label="Global shortcut"
          hint={`Opens the quick menu from anywhere, even when the app is in the background. Format: ${isMac ? "CommandOrControl+Shift+Space" : "Control+Alt+Space"}.${platform.kind !== "tauri" ? " (Desktop app only.)" : ""}`}
        >
          <div className="flex items-center gap-2">
            <Input value={hotkey} onChange={(e) => setHotkey(e.target.value)} className="max-w-64 font-mono text-xs" />
            <Button
              variant="outline"
              size="sm"
              disabled={hotkey === settings.hotkey}
              onClick={async () => {
                setHotkeyError(null);
                try {
                  await applyHotkey(hotkey);
                  await update("hotkey", hotkey);
                } catch (e) {
                  setHotkeyError(String(e));
                }
              }}
            >
              Save
            </Button>
          </div>
          {hotkeyError && <p className="mt-1 text-xs text-destructive">{hotkeyError}</p>}
        </Row>
      </div>
    </div>
  );
}

function UpdatesRow({ desktop }: { desktop: boolean }) {
  const { version, status: rawStatus, check, install, restart } = useUpdates();
  const status = desktop ? rawStatus : ({ kind: "browser" } as const);
  const [historyOpen, setHistoryOpen] = useState(false);
  return (
    <Row
      label="Updates"
      hint={desktop ? `You're on Forgor ${version || "…"}. Updates are only installed when you click Install.` : "Updates are available in the desktop app."}
    >
      <div className="space-y-2" data-testid="updates">
        {(status.kind === "idle" || status.kind === "up-to-date" || status.kind === "error") && (
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => check()}>
              <RefreshCw /> Check for updates
            </Button>
            {status.kind === "up-to-date" && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <CheckCircle2 className="size-3.5 text-success" /> Up to date (checked {format(status.checkedAt, "HH:mm")})
              </span>
            )}
          </div>
        )}
        {status.kind === "error" && <p className="text-xs text-destructive">{status.message}</p>}
        {status.kind === "checking" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Checking…
          </p>
        )}
        {(status.kind === "available" || status.kind === "installing" || status.kind === "ready") && (
          <div className="rounded border p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium">Forgor {status.update.version} is available</div>
              {status.kind === "available" && (
                <Button size="sm" onClick={install}>
                  <Download /> Install update
                </Button>
              )}
              {status.kind === "ready" && (
                <Button size="sm" onClick={restart}>
                  <RotateCw /> Restart to finish
                </Button>
              )}
            </div>
            {status.kind === "installing" && (
              <div className="mt-3">
                <div className="h-1.5 overflow-hidden rounded-sm bg-muted">
                  <div
                    className={status.progress === null ? "h-full w-1/3 animate-pulse bg-primary" : "h-full bg-primary transition-[width]"}
                    style={status.progress === null ? undefined : { width: `${Math.round(status.progress * 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Downloading{status.progress !== null && ` ${Math.round(status.progress * 100)}%`}… The app may close and reopen by itself.
                </p>
              </div>
            )}
            {status.update.notes && (
              <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap font-sans text-xs text-muted-foreground">{status.update.notes}</pre>
            )}
          </div>
        )}
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground hover:text-foreground" onClick={() => setHistoryOpen(true)} data-testid="open-version-history">
            <History /> Version history
          </Button>
        </div>
        <VersionHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />
      </div>
    </Row>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[200px_1fr] gap-4 border-b pb-5">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
