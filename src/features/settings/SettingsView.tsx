import { useState } from "react";
import { FolderOpen, RefreshCw, CheckCircle2, Loader2, Download, RotateCw, History, Trash2, Play } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { showError } from "@/components/Toasts";
import { VersionHistoryDialog } from "./VersionHistoryDialog";
import { ACCENTS } from "@/lib/accents";
import { SwatchGrid, type Swatch } from "@/components/ColorPicker";

const ACCENT_SWATCHES: Swatch[] = ACCENTS.map((a) => ({
  id: a.id,
  label: a.label,
  css: `light-dark(${a.light}, ${a.dark})`,
  checkCss: `light-dark(#fff, ${a.darkForeground ?? "#fff"})`,
}));
import { format } from "date-fns";
import { useUpdates } from "@/app/updates";
import { confirmDialog } from "@/components/ConfirmDialog";
import { useUI } from "@/app/store";
import { PageHeader } from "@/features/todos/TodosPage";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { notifications } from "@/platform/notifications";
import { sendTestNotification } from "@/app/notifications";

/** The test notification waits this long, so you can switch to another app and see its banner. */
const TEST_DELAY = 5000;
import { ctx } from "@/data/context";
import type { Platform } from "@/platform/types";
import type { NotificationSound, Settings } from "@/data/types";
import { chooseVault } from "@/app/boot";
import { isMac } from "@/lib/keys";
import { ZOOM_LEVELS, zoomLabel } from "@/lib/zoom";
import { applyHotkey } from "@/app/hotkey";
import { Row } from "./Row";
import { ModelsSettings } from "@/features/models/ModelsSettings";
import { StorageRow } from "./StorageRow";
import { useTrash } from "@/app/queries";

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
          {/* Stored as theme + themeSoft (an older version then still knows the theme). */}
          <Select
            aria-label="Theme"
            value={settings.theme === "system" ? "system" : `${settings.theme}${settings.themeSoft ? "-soft" : ""}`}
            onChange={async (v) => {
              await update("themeSoft", v.endsWith("-soft"));
              await update("theme", v.replace("-soft", "") as Settings["theme"]);
            }}
            options={[
              { value: "system", label: "Follow system" },
              { value: "light", label: "Light" },
              { value: "light-soft", label: "Light (soft)" },
              { value: "dark", label: "Dark" },
              { value: "dark-soft", label: "Dark (soft)" },
            ]}
          />
        </Row>

        <Row
          label="Zoom"
          hint={`Makes everything bigger or smaller. Shortcuts: ${isMac ? "⌘+ / ⌘− / ⌘0" : "Ctrl++ / Ctrl+− / Ctrl+0"}.${platform.kind !== "tauri" ? " (Desktop app only; in the browser use its own zoom.)" : ""}`}
        >
          <Select<string>
            aria-label="Zoom"
            value={String(settings.zoom)}
            onChange={(v) => update("zoom", Number(v))}
            options={(ZOOM_LEVELS.includes(settings.zoom) ? ZOOM_LEVELS : [...ZOOM_LEVELS, settings.zoom].sort((a, b) => a - b)).map((z) => ({
              value: String(z),
              label: zoomLabel(z),
            }))}
          />
        </Row>

        <Row label="Highlight color" hint="Used for buttons, selections, links and the today marker.">
          <div data-testid="accent-picker">
            <SwatchGrid presets={ACCENT_SWATCHES} value={settings.accent} onPick={(id) => update("accent", id)} size="md" label="Highlight color" />
          </div>
        </Row>

        <Row label="Archive completed todos after" hint="Completed todos stay visible for this long, then move to the Archive.">
          <Select<string>
            value={String(settings.archiveAfterDays)}
            onChange={(v) => update("archiveAfterDays", Number(v))}
            options={[1, 3, 7, 14, 30, 90].map((d) => ({ value: String(d), label: `${d} day${d === 1 ? "" : "s"}` }))}
          />
        </Row>

        <TrashRow />

        <NotificationsRow />

        <ModelsSettings />

        <StorageRow desktop={platform.kind === "tauri"} />

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

/** Deleted notes, folders, todos and files: opened from here (no longer in the sidebar). */
function TrashRow() {
  const { data: items = [] } = useTrash();
  return (
    <Row label="Trash" hint="Deleted notes, folders, todos and files. Restore them, or delete them for good.">
      <Button variant="outline" size="sm" onClick={() => useUI.getState().setView({ kind: "trash" })} data-testid="open-trash">
        <Trash2 /> Open trash{items.length ? ` (${items.length})` : ""}
      </Button>
    </Row>
  );
}

/** Desktop notifications for all of Forgor; which kinds is chosen per plugin (in its panel). */
function NotificationsRow() {
  const on = useUI((s) => s.settings.notificationsEnabled);
  const sound = useUI((s) => s.settings.notificationSound);
  const update = useUI((s) => s.updateSetting);
  const [tested, setTested] = useState<"waiting" | "sent" | "blocked" | null>(null);
  return (
    <Row label="Notifications" hint="Desktop notifications, e.g. for new review requests or Jira comments, while Forgor runs (also in the tray). Choose which ones in each plugin's panel.">
      <div className="flex flex-wrap items-center gap-3">
        <Switch checked={on} onCheckedChange={(v) => void update("notificationsEnabled", v)} aria-label="Notifications" data-testid="notifications-enabled" />
        <div className="flex items-center gap-1">
          <Select<NotificationSound>
            aria-label="Notification sound"
            value={sound}
            onChange={(v) => {
              void update("notificationSound", v);
              if (v !== "none") void notifications().playSound(v);
            }}
            options={[
              { value: "chime", label: "Sound: Chime" },
              { value: "ping", label: "Sound: Ping" },
              { value: "pop", label: "Sound: Pop" },
              { value: "none", label: "No sound" },
            ]}
          />
          <Tooltip content="Play the sound">
            <Button variant="ghost" size="icon" disabled={sound === "none"} onClick={() => void notifications().playSound(sound).catch((e) => showError(e, "Couldn't play the sound"))} aria-label="Play the sound" data-testid="notifications-play-sound">
              <Play />
            </Button>
          </Tooltip>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!on || tested === "waiting"}
          onClick={() => {
            // In 5 s: macOS shows no banner for the app in front, so there's time to switch away and see the real one.
            setTested("waiting");
            setTimeout(() => void sendTestNotification().then((ok) => setTested(ok ? "sent" : "blocked")), TEST_DELAY);
          }}
          data-testid="notifications-test"
        >
          Send a test notification
        </Button>
        {tested === "waiting" && <span className="text-xs text-muted-foreground" data-testid="notifications-test-waiting">Switch to another app: it arrives in 5 seconds.</span>}
        {tested === "blocked" && <span className="text-xs text-warning">Not allowed: turn on notifications for Forgor in your system settings.</span>}
        {tested === "sent" && <span className="text-xs text-muted-foreground">Sent. Didn't see it? Check your system's notification settings for Forgor (and Focus / Do Not Disturb).</span>}
      </div>
    </Row>
  );
}
