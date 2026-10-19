import { useEffect, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { StorePlugin } from "@/platform/store";
import { getPublishKey, keyPlace, publishToStore } from "@/plugins/store";
import type { Plugin } from "@/plugins/types";

/** Publish a plugin (as it's loaded now) to the store, or a new version of it. */
export function PublishDialog({ plugin, entry, onClose }: { plugin: Plugin; entry: StorePlugin | null; onClose: () => void }) {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ version: string; newKey: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => void getPublishKey(plugin.id).then((k) => setHasKey(!!k), () => setHasKey(false)), [plugin.id]);
  const needsKey = !!entry && hasKey === false;

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      setDone(await publishToStore(plugin.id, needsKey ? key : undefined));
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent title={entry ? `Publish ${plugin.name} v${plugin.version}` : `Publish ${plugin.name} to the store`} className="w-[480px]" data-testid="publish-dialog">
        {done ? (
          <div className="space-y-3 text-sm">
            <p className="flex items-center gap-1.5">
              <Check className="size-4 text-success" /> {plugin.name} v{done.version} is in the store. Anyone can install it now.
            </p>
            {done.newKey && (
              <div className="space-y-2 rounded border bg-muted/40 p-3">
                <p className="text-xs">
                  Its <b>publish key</b> is saved in {keyPlace()}. You need it to publish new versions. Keep a copy somewhere safe: without it nobody can update this plugin.
                </p>
                <div className="flex gap-2">
                  <Input readOnly value={done.newKey} className="font-mono text-xs" aria-label="Publish key" data-testid="publish-key" onFocus={(e) => e.currentTarget.select()} />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard.writeText(done.newKey!).then(() => setCopied(true));
                    }}
                  >
                    {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
            )}
            <div className="flex justify-end">
              <Button size="sm" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-3 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              void publish();
            }}
          >
            {entry ? (
              <p>
                The store has v{entry.version}. This uploads v{plugin.version} as it is installed here; everyone who has it gets the update offered.
              </p>
            ) : (
              <p>
                This uploads {plugin.name} v{plugin.version} as it is installed here. It shows up in the store right away, under the id <code className="rounded bg-muted px-1 text-xs">{plugin.id}</code> and the author name “{plugin.author}”.
              </p>
            )}
            {needsKey && (
              <label className="block space-y-1">
                <span className="text-xs font-medium">Publish key</span>
                <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="fpk_…" className="font-mono text-xs" autoFocus aria-label="Publish key" spellCheck={false} />
                <span className="block text-xs text-muted-foreground">This computer doesn't have the key for “{plugin.id}”. Paste the one you got when you first published it.</span>
              </label>
            )}
            {error && (
              <p className="text-xs text-destructive" data-testid="publish-error">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={busy || hasKey === null || (needsKey && !key.trim())} data-testid="publish-confirm">
                {busy && <Loader2 className="animate-spin" />} Publish
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
