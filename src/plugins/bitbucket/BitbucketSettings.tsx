import { useState } from "react";
import { CheckCircle2, ExternalLink, KeyRound, Loader2 } from "lucide-react";
import { Setting } from "../ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { confirmDialog } from "@/components/ConfirmDialog";
import { showError } from "@/components/Toasts";
import { useUI } from "@/app/store";
import { openExternal } from "@/platform/os";
import { isTauri } from "@/platform/env";
import { connectBitbucket, disconnectBitbucket } from "./state";

const TOKEN_PAGE = "https://id.atlassian.com/manage-profile/security/api-tokens";
const SCOPES = ["read:user:bitbucket", "read:workspace:bitbucket", "read:repository:bitbucket", "read:pullrequest:bitbucket"];

/** The Bitbucket plugin's settings: the connected account. */
export function BitbucketSettings() {
  const account = useUI((s) => s.settings.bitbucketAccount);
  const [connecting, setConnecting] = useState(false);

  return (
    <Setting label="Account" hint={`Link a repository to a folder in the folder's panel.${isTauri() ? "" : " (The browser build uses a demo account.)"}`}>
      <div className="rounded border px-3 py-2" data-testid="bitbucket-account">
        {account ? (
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4 shrink-0 text-success" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{account.displayName}</div>
              <div className="truncate text-xs text-muted-foreground">{account.email}</div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                const ok = await confirmDialog({
                  title: "Disconnect Bitbucket?",
                  message: "Forgor forgets the API token. Repositories linked to folders stay linked, for when you connect again.",
                  confirmLabel: "Disconnect",
                });
                if (ok) await disconnectBitbucket().catch((e) => showError(e, "Couldn't disconnect"));
              }}
              data-testid="bitbucket-disconnect"
            >
              Disconnect
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="flex-1 text-sm text-muted-foreground">Not connected</span>
            <Button size="sm" onClick={() => setConnecting(true)} data-testid="bitbucket-connect">
              <KeyRound /> Connect account
            </Button>
          </div>
        )}
      </div>
      {connecting && <ConnectDialog onClose={() => setConnecting(false)} />}
    </Setting>
  );
}

function ConnectDialog({ onClose }: { onClose: () => void }) {
  // The same Atlassian account as Jira, usually.
  const [email, setEmail] = useState(() => useUI.getState().settings.jiraAccount?.email ?? "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await connectBitbucket(email, token);
      onClose();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Connect Bitbucket" data-testid="bitbucket-connect-dialog">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="block">
            <span className="mb-1 block text-xs font-medium">Email of your Atlassian account</span>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoFocus={!email} aria-label="Email" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium">API token with Bitbucket scopes</span>
            <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoFocus={!!email} aria-label="API token" />
          </label>
          <div className="space-y-1.5 text-xs text-muted-foreground">
            <p>
              Under{" "}
              <button type="button" className="inline-flex items-center gap-0.5 text-primary underline underline-offset-2" onClick={() => void openExternal(TOKEN_PAGE)}>
                Atlassian account → Security → API tokens <ExternalLink className="size-3" />
              </button>
              , choose <b>Create API token with scopes</b>, pick <b>Bitbucket</b>, and give it these (all read-only):
            </p>
            <p className="flex flex-wrap gap-1">
              {SCOPES.map((s) => (
                <code key={s} className="rounded bg-muted px-1 font-mono text-[11px]">
                  {s}
                </code>
              ))}
            </p>
            <p>A Jira token doesn't work for Bitbucket. The token is stored in your computer's keychain, not in Forgor's database.</p>
          </div>
          {error && (
            <p className="text-xs text-destructive" data-testid="bitbucket-connect-error">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={busy || !email.trim() || !token.trim()} data-testid="bitbucket-connect-submit">
              {busy && <Loader2 className="animate-spin" />} Connect
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
