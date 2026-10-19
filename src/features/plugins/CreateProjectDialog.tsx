import { useState } from "react";
import { Check, Copy, FolderOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { isTauri } from "@/platform/env";
import { localPlugins } from "@/platform/plugins";
import { PLUGINS } from "@/plugins/registry";
import { usePluginStore } from "@/plugins/store";
import { version as APP_VERSION } from "../../../package.json";
import { PLUGIN_ID, projectFiles, slug } from "./template/project";
import { projectSources } from "./template/sources";

const AUTHOR_KEY = "forgor.plugins.author";

/** Plugins → Create plugin project: a ready-to-build plugin project (with AGENTS.md for AI help) where you choose. */
export function CreateProjectDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [id, setId] = useState<string | null>(null); // null: follows the name
  const [author, setAuthor] = useState(() => {
    try {
      return localStorage.getItem(AUTHOR_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const store = usePluginStore((s) => s.plugins);

  const pluginId = id ?? slug(name);
  const validId = PLUGIN_ID.test(pluginId);
  const taken = PLUGINS.some((p) => p.id === pluginId) ? "installed here" : store?.some((p) => p.id === pluginId) ? "in the store" : null;
  const desktop = isTauri();

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      try {
        localStorage.setItem(AUTHOR_KEY, author.trim());
      } catch {
        // not remembered
      }
      const files = projectFiles({ id: pluginId, name: name.trim(), author: author.trim(), description: description.trim(), appVersion: APP_VERSION }, projectSources);
      const where = await localPlugins().createProject(pluginId, files);
      if (where !== null) setCreated(where);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const steps = [...(created ? [`cd "${created}"`] : created === "" ? [`# unzip ${pluginId}.zip, then:`, `cd ${pluginId}`] : []), "npm install", "npm run zip"].join("\n");

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent title={created === null ? "Create a plugin project" : "Plugin project created"} className="w-[520px]" data-testid="create-project-dialog">
        {created === null ? (
          <form
            className="space-y-3 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <p className="text-xs text-muted-foreground">
              A folder with everything to build a plugin: a working example, the build, a command that makes the zip, and an AGENTS.md that explains the whole plugin API (so an AI assistant can help you write it).
            </p>
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My plugin" autoFocus aria-label="Plugin name" maxLength={80} />
            </Field>
            <Field label="Id" hint={!pluginId ? "Lowercase letters, digits and dashes. It can't change once published." : !validId ? "Only lowercase letters, digits and dashes." : taken ? `A plugin with this id is already ${taken}. Choose another.` : `Also the folder name. It can't change once the plugin is published.`} warn={!!pluginId && (!validId || !!taken)}>
              <Input value={pluginId} onChange={(e) => setId(e.target.value.toLowerCase())} placeholder="my-plugin" aria-label="Plugin id" className="font-mono text-xs" spellCheck={false} maxLength={64} />
            </Field>
            <Field label="Author">
              <Input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Your name" aria-label="Author" maxLength={80} />
            </Field>
            <Field label="Description">
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One or two sentences: what it does." rows={2} aria-label="Description" maxLength={500} />
            </Field>
            {error && (
              <p className="text-xs text-destructive" data-testid="create-project-error">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={busy || !name.trim() || !author.trim() || !validId || !!taken} data-testid="create-project-confirm">
                {busy && <Loader2 className="animate-spin" />} {desktop ? "Choose where and create" : "Create (downloads a zip)"}
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-3 text-sm" data-testid="create-project-done">
            <p className="flex items-center gap-1.5">
              <Check className="size-4 text-success" /> {created ? <span className="min-w-0 break-all">Created in {created}</span> : `Downloaded ${pluginId}.zip`}
            </p>
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Next, in a terminal (you need Node.js):</p>
              <div className="relative">
                <pre className="select-text overflow-x-auto rounded border bg-muted/50 p-3 pr-16 font-mono text-xs">{steps}</pre>
                <Button
                  size="sm"
                  variant="ghost"
                  className="absolute right-1 top-1"
                  onClick={() => void navigator.clipboard.writeText(steps.split("\n").filter((l) => !l.startsWith("#")).join(" && ")).then(() => setCopied(true))}
                  aria-label="Copy the commands"
                >
                  {copied ? <Check /> : <Copy />}
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                That makes <code className="rounded bg-muted px-1">{pluginId}-1.0.0.zip</code>: install it here with <b>Install from zip</b>. After a change, run <code className="rounded bg-muted px-1">npm run zip</code> again and use <b>Update from zip</b> in its panel. Everything about writing it is in <b>AGENTS.md</b> in the project.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              {created && localPlugins().openFolder && (
                <Button size="sm" variant="outline" onClick={() => void localPlugins().openFolder!(created)}>
                  <FolderOpen /> Open folder
                </Button>
              )}
              <Button size="sm" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, hint, warn, children }: { label: string; hint?: string; warn?: boolean; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium">{label}</span>
      {children}
      {hint && <span className={warn ? "block text-xs text-destructive" : "block text-xs text-muted-foreground"}>{hint}</span>}
    </label>
  );
}
