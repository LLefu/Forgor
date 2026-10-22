import { Ticket } from "lucide-react";
import { TodayCard, TodayList } from "@/features/today/TodayCard";
import { todayStr } from "@/lib/dates";
import { pluginView } from "../host";
import { IssueRow } from "./IssueRow";
import { useJiraAccount, useMyIssues } from "./state";

/** Today: how many open tickets are assigned to me (the overview's and sidebar's query, so no extra request). */
export function JiraTodayCards() {
  const account = useJiraAccount();
  const { data } = useMyIssues(false);
  if (!account) return null;
  const today = todayStr();
  const inProgress = data?.filter((i) => i.statusCategory === "indeterminate").length ?? 0;
  const overdue = data?.filter((i) => !!i.due && i.due < today).length ?? 0;
  return (
    <TodayCard
      icon={Ticket}
      label="Open tickets"
      count={data?.length}
      detail={data ? (overdue ? `${overdue} past due` : `${inProgress} in progress`) : undefined}
      tone={overdue ? "danger" : undefined}
      target={pluginView("jira", "overview")}
      testId="today-card-jira"
    />
  );
}

/** Today: my tickets in progress, and open ones due today or earlier. */
export function JiraTodaySection() {
  const account = useJiraAccount();
  const { data = [] } = useMyIssues(false);
  if (!account) return null;
  const today = todayStr();
  const now = data.filter((i) => i.statusCategory === "indeterminate" || (!!i.due && i.due <= today));
  return (
    <TodayList
      title="Tickets in progress or due"
      rows={now.map((i) => <IssueRow key={i.key} issue={i} showProject />)}
      target={pluginView("jira", "overview")}
      testId="today-jira"
    />
  );
}
