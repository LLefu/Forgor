import { FolderGit2, GitPullRequest } from "lucide-react";
import { useFolders } from "@/app/queries";
import { NavItem } from "@/components/NavItem";
import { basename } from "@/lib/paths";
import type { Plugin } from "../types";
import { pluginView } from "../host";
import { PullRequestsFolderPage, PullRequestsOverview } from "./PullRequestPages";
import { PullRequestPanel } from "./PullRequestPanel";
import { FolderBitbucket } from "./FolderBitbucket";
import { BitbucketSettings } from "./BitbucketSettings";
import { myReview } from "@/lib/bitbucket";
import { useBitbucketAccount, useLinkedRepos, usePullRequests } from "./state";
import { BITBUCKET_NOTIFICATIONS, startBitbucketNotifications } from "./notify";

/** Sidebar: Pull requests, with how many review requests still wait for me (not yet approved or changes requested). Same queries as the overview. */
function PullRequestsNav() {
  const account = useBitbucketAccount();
  const { data } = usePullRequests(useLinkedRepos());
  const waiting = data?.filter((p) => p.role === "review" && myReview(p, account?.uuid ?? "") === "waiting").length;
  return <NavItem icon={GitPullRequest} label="Pull requests" count={waiting} target={pluginView("bitbucket", "overview")} testId="nav-pull-requests" />;
}

/** Bitbucket Cloud, read-only: my open pull requests and the ones waiting for my review, per folder (linked repositories) and together. */
export const bitbucketPlugin: Plugin = {
  id: "bitbucket",
  name: "Bitbucket",
  description:
    "See your open pull requests and the ones waiting for your review: per folder (link repositories in the folder's panel) and all together. Read-only: Forgor never changes anything in Bitbucket.",
  version: "1.0.0",
  author: "Forgor",
  icon: GitPullRequest,
  builtIn: true,
  settings: BitbucketSettings,
  sidebar: PullRequestsNav,
  pages: {
    overview: { useTab: () => ({ label: "Pull requests", icon: GitPullRequest }), component: () => <PullRequestsOverview /> },
    folder: {
      useTab: (folderId) => {
        const { data: folders = [] } = useFolders();
        const folder = folders.find((f) => f.id === folderId);
        return { label: `Pull requests · ${folder ? basename(folder.path) : "folder"}`, icon: FolderGit2 };
      },
      component: ({ param }) => (param ? <PullRequestsFolderPage key={param} folderId={param} /> : null),
    },
  },
  panels: { pr: PullRequestPanel },
  folderSection: FolderBitbucket,
  remoteQueries: ["bitbucket"],
  notifications: BITBUCKET_NOTIFICATIONS,
  start: startBitbucketNotifications,
};
