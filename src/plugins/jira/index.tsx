import { SquareKanban, Ticket } from "lucide-react";
import { useFolders } from "@/app/queries";
import { NavItem } from "@/components/NavItem";
import { basename } from "@/lib/paths";
import type { Plugin } from "../types";
import { pluginView } from "../host";
import { JiraFolderPage, JiraOverview } from "./JiraPages";
import { IssuePanel } from "./IssuePanel";
import { FolderJira } from "./FolderJira";
import { JiraTodayCards, JiraTodaySection } from "./Today";
import { JiraSettings } from "./JiraSettings";
import { useMyIssues } from "./state";
import { JIRA_NOTIFICATIONS, startJiraNotifications } from "./notify";
import { jiraChat } from "./chat";

/** Sidebar: Jira, with how many open tickets are assigned to me (the overview's own query, so no extra request). */
function JiraNav() {
  const { data } = useMyIssues(false);
  return <NavItem icon={Ticket} label="Jira" count={data?.length} target={pluginView("jira", "overview")} testId="nav-jira" />;
}

/** Jira Cloud, read-only: my tickets per folder (linked boards) and all together. */
export const jiraPlugin: Plugin = {
  id: "jira",
  name: "Jira",
  description: "See the Jira tickets assigned to you: per folder (link boards in the folder's panel) and all together. Read-only: Forgor never changes anything in Jira.",
  version: "1.1.1",
  author: "Forgor",
  icon: Ticket,
  builtIn: true,
  settings: JiraSettings,
  sidebar: JiraNav,
  pages: {
    overview: { useTab: () => ({ label: "Jira", icon: Ticket }), component: () => <JiraOverview /> },
    folder: {
      useTab: (folderId) => {
        const { data: folders = [] } = useFolders();
        const folder = folders.find((f) => f.id === folderId);
        return { label: `Jira · ${folder ? basename(folder.path) : "folder"}`, icon: SquareKanban };
      },
      component: ({ param }) => (param ? <JiraFolderPage key={param} folderId={param} /> : null),
    },
  },
  panels: { issue: IssuePanel },
  folderSection: FolderJira,
  today: { cards: JiraTodayCards, section: JiraTodaySection },
  remoteQueries: ["jira"],
  notifications: JIRA_NOTIFICATIONS,
  start: startJiraNotifications,
  chat: jiraChat,
};
