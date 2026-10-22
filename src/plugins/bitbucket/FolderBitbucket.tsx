import { useState } from "react";
import { ChevronRight, FolderGit2, Loader2, Plus, X } from "lucide-react";
import { useUI } from "@/app/store";
import { setFolderBitbucketRepos } from "@/data/notes";
import type { Folder } from "@/data/types";
import { Section } from "@/features/todos/TodosPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { matchRepos, prRef, sameRepo, type BitbucketRepoRef } from "@/lib/bitbucket";
import { openPluginSettings, pluginView } from "../host";
import { useAllRepos, useBitbucketAccount, usePullRequests } from "./state";
import { PullRequestRow } from "./PullRequestRow";

/** In the folder panel: the folder's Bitbucket repositories and my open PRs / review requests in them. */
export function FolderBitbucket({ folder }: { folder: Folder }) {
  const account = useBitbucketAccount();
  if (!account) {
    return (
      <Section title="Pull requests">
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          <button className="underline underline-offset-2 hover:text-foreground" onClick={() => openPluginSettings("bitbucket")}>
            Connect your Bitbucket account
          </button>{" "}
          to link a repository to this folder.
        </p>
      </Section>
    );
  }
  return <FolderRepos folder={folder} repos={folder.bitbucketRepos ?? []} />;
}

/** Shown in the folder; the rest is behind "View all". */
const PREVIEW = 8;

function FolderRepos({ folder, repos }: { folder: Folder; repos: BitbucketRepoRef[] }) {
  const { data: prs = [], isLoading, error } = usePullRequests(repos);
  // Inline like the Jira board picker (a popover from a menu closed right away).
  const [adding, setAdding] = useState(false);
  const linked = repos.length > 0;
  const add = (r: BitbucketRepoRef) => void setFolderBitbucketRepos(folder.id, [...repos.filter((x) => !sameRepo(x, r)), r]).then(() => setAdding(false));
  const remove = (r: BitbucketRepoRef) => void setFolderBitbucketRepos(folder.id, repos.filter((x) => !sameRepo(x, r)));

  return (
    <div data-testid="folder-bitbucket">
      <Section title="Pull requests" count={linked && !isLoading ? prs.length : undefined}>
        <div className="flex flex-wrap items-center gap-1.5 px-2 pb-1.5 pt-0.5">
          {repos.map((r) => (
            <span key={`${r.workspace}/${r.slug}`} className="inline-flex max-w-full items-center gap-1 rounded border py-0.5 pl-1.5 pr-0.5 text-xs" data-testid="bitbucket-repo-chip">
              <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate" title={`${r.workspace}/${r.slug}`}>
                {r.name}
              </span>
              <Tooltip content="Unlink this repository">
                <button className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => remove(r)} aria-label={`Unlink ${r.name}`}>
                  <X className="size-3" />
                </button>
              </Tooltip>
            </span>
          ))}
          {!adding && (
            <Button variant={linked ? "ghost" : "outline"} size="sm" className="h-6 px-1.5 text-xs" onClick={() => setAdding(true)} data-testid="bitbucket-link-repo">
              <Plus /> {linked ? "Add repository" : "Link a Bitbucket repository"}
            </Button>
          )}
        </div>
        {adding && (
          <div className="px-1 pb-2">
            <RepoList onPick={add} onCancel={() => setAdding(false)} exclude={repos} />
          </div>
        )}

        {!linked ? (
          !adding && <p className="px-2 text-xs text-muted-foreground">Shows your open pull requests and the ones waiting for your review here.</p>
        ) : isLoading ? (
          <p className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading pull requests…
          </p>
        ) : error ? (
          <p className="px-2 py-1.5 text-xs text-destructive">{String((error as Error).message ?? error)}</p>
        ) : prs.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">No open pull requests of yours or waiting for your review.</p>
        ) : (
          // Review requests first: they're waiting on you.
          [...prs.filter((p) => p.role === "review"), ...prs.filter((p) => p.role === "mine")].slice(0, PREVIEW).map((p) => <PullRequestRow key={prRef(p)} pr={p} fromFolder={folder.id} />)
        )}
        {linked && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 text-xs text-muted-foreground"
            onClick={() => useUI.getState().setView(pluginView("bitbucket", "folder", folder.id))}
            data-testid="bitbucket-view-all"
          >
            View all{prs.length > PREVIEW ? ` (${prs.length})` : ""} <ChevronRight />
          </Button>
        )}
      </Section>
    </div>
  );
}

/** Search and pick a repository; × or Esc cancels. */
function RepoList({ onPick, onCancel, exclude }: { onPick: (r: BitbucketRepoRef) => void; onCancel: () => void; exclude: BitbucketRepoRef[] }) {
  const [name, setName] = useState("");
  const { data = [], isLoading, error } = useAllRepos(true);
  const matches = matchRepos(data, name);
  const repos = matches.filter((r) => !exclude.some((x) => sameRepo(x, r)));
  const workspaces = new Set(data.map((r) => r.workspace)).size;
  return (
    <div data-testid="bitbucket-repo-picker">
      <div className="flex items-center gap-1">
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation(); // not the panel too
              onCancel();
            }
          }}
          placeholder="Search repositories"
          aria-label="Search repositories"
        />
        <Tooltip content="Cancel (Esc)">
          <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={onCancel} aria-label="Cancel" data-testid="bitbucket-repo-cancel">
            <X />
          </Button>
        </Tooltip>
      </div>
      <div className="mt-2 max-h-72 overflow-y-auto">
        {isLoading ? (
          <p className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading repositories…
          </p>
        ) : error ? (
          <p className="px-2 py-2 text-xs text-destructive">{String((error as Error).message ?? error)}</p>
        ) : repos.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            {matches.length ? "Those repositories are already linked to this folder." : data.length ? "No repository matches that name." : "No repositories found."}
          </p>
        ) : (
          repos.map((r) => (
            <button
              key={`${r.workspace}/${r.slug}`}
              onClick={() => onPick(r)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-muted"
              data-testid="bitbucket-repo-option"
            >
              <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              {workspaces > 1 && <span className="shrink-0 truncate text-xs text-muted-foreground">{r.workspace}</span>}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
