import { useEffect, useState } from "react";
import { FolderOpen, NotebookPen } from "lucide-react";
import type { Platform } from "@/platform/types";
import { Button } from "@/components/ui/button";

/** First run on desktop: pick where the markdown notes live. */
export function VaultSetup({ platform, onChosen }: { platform: Platform; onChosen: (path: string) => Promise<void> }) {
  const [suggested, setSuggested] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    platform.defaultVaultPath().then(setSuggested);
  }, [platform]);

  const choose = async (path: string | null) => {
    if (!path) return;
    setBusy(true);
    try {
      await onChosen(path);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-sidebar">
      <div className="w-[460px] rounded border bg-background p-8 shadow-sm">
        <NotebookPen className="size-8 text-primary" />
        <h1 className="mt-4 text-xl font-semibold">Welcome to Work Notes</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Choose where your notes live. Each note is a plain markdown file and each folder a project, so you can also open them in VS Code or any other editor.
        </p>
        <div className="mt-6 space-y-2">
          <Button className="w-full justify-start" disabled={busy || !suggested} onClick={() => choose(suggested)}>
            <FolderOpen /> Use <span className="truncate font-mono text-xs">{suggested || "…"}</span>
          </Button>
          <Button variant="outline" className="w-full justify-start" disabled={busy} onClick={async () => choose(await platform.pickVaultFolder())}>
            <FolderOpen /> Choose another folder…
          </Button>
        </div>
      </div>
    </div>
  );
}
