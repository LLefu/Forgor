import { useState } from "react";
import { CheckCircle2, ExternalLink, KeyRound, Loader2 } from "lucide-react";
import { Row } from "@/features/settings/Row";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { confirmDialog } from "@/components/ConfirmDialog";
import { showError } from "@/components/Toasts";
import { useUI } from "@/app/store";
import { connectJira, disconnectJira } from "@/app/jira";
import { openExternal } from "@/platform/os";

const TOKEN_PAGE = "https://id.atlassian.com/manage-profile/security/api-tokens";

/** Settings → Jira: the toggle and the connected account. */
export function JiraSettings({ desktop }: { desktop: boolean }) {
  const enabled = useUI((s) => s.settings.jiraEnabled);
  const account = useUI((s) => s.settings.jiraAccount);
  const update = useUI((s) => s.updateSetting);
  const [connecting, setConnecting] = useState(false);

  return (
    <Row
      label="Jira"
      hint={`See the Jira tickets assigned to you: per folder (link a board in the folder's panel) and all together under Jira in the sidebar. Read-only: Forgor never changes anything in Jira.${desktop ? "" : " (The browser build uses a demo site.)"}`}
    >
      <div className="flex items-center gap-2">
        <Switch checked={enabled} onCheckedChange={(v) => void update("jiraEnabled", v)} aria-label="Jira integration" data-testid="jira-toggle" />
        <span className="text-sm">{enabled ? "On" : "Off"}</span>
      </div>
      {enabled && (
        <div className="mt-4 rounded border px-3 py-2" data-testid="jira-account">
          {account ? (
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4 shrink-0 text-success" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{account.displayName}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {account.email} · {account.site.replace("https://", "")}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const ok = await confirmDialog({
                    title: "Disconnect Jira?",
                    message: "Forgor forgets the API token. Boards linked to folders stay linked, for when you connect again.",
                    confirmLabel: "Disconnect",
                  });
                  if (ok) await disconnectJira().catch((e) => showError(e, "Couldn't disconnect"));
                }}
                data-testid="jira-disconnect"
              >
                Disconnect
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="flex-1 text-sm text-muted-foreground">Not connected</span>
              <Button size="sm" onClick={() => setConnecting(true)} data-testid="jira-connect">
                <KeyRound /> Connect account
              </Button>
            </div>
          )}
        </div>
      )}
      {connecting && <ConnectDialog onClose={() => setConnecting(false)} />}
    </Row>
  );
}

function ConnectDialog({ onClose }: { onClose: () => void }) {
  const [site, setSite] = useState("");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await connectJira(site, email, token);
      onClose();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Connect Jira" data-testid="jira-connect-dialog">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="block">
            <span className="mb-1 block text-xs font-medium">Jira address</span>
            <Input value={site} onChange={(e) => setSite(e.target.value)} placeholder="yourcompany.atlassian.net" autoFocus aria-label="Jira address" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium">Email of your Atlassian account</span>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" aria-label="Email" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium">API token</span>
            <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} aria-label="API token" />
          </label>
          <p className="text-xs text-muted-foreground">
            Create a token under{" "}
            <button type="button" className="inline-flex items-center gap-0.5 text-primary underline underline-offset-2" onClick={() => void openExternal(TOKEN_PAGE)}>
              Atlassian account → Security → API tokens <ExternalLink className="size-3" />
            </button>{" "}
            and paste it here. It's stored in your computer's keychain, not in Forgor's database.
          </p>
          {error && (
            <p className="text-xs text-destructive" data-testid="jira-connect-error">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={busy || !site.trim() || !email.trim() || !token.trim()} data-testid="jira-connect-submit">
              {busy && <Loader2 className="animate-spin" />} Connect
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
