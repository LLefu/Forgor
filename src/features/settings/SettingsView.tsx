import { useState } from "react";
import { FolderOpen } from "lucide-react";
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
        <Row label="Notes folder" hint="Your notes are plain .md files in this folder. You can open them in any editor.">
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 text-xs">{ctx().vault.rootLabel}</code>
            {platform.kind === "tauri" && (
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  const picked = await platform.pickVaultFolder();
                  if (picked && confirm(`Switch notes folder to:\n${picked}\n\nTodos stay; links to notes in the old folder will be hidden.`)) {
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
