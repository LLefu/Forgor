import { Eye, GitPullRequest } from "lucide-react";
import { TodayCard, TodayList } from "@/features/today/TodayCard";
import { myReview, prRef, summarizeBuilds } from "@/lib/bitbucket";
import { pluginView } from "../host";
import { PullRequestRow } from "./PullRequestRow";
import { useBitbucketAccount, useBuildsOf, useLinkedRepos, usePullRequests } from "./state";

const overview = pluginView("bitbucket", "overview");

/** The overview's own query (mine everywhere + review requests in linked repos), so Today and the page share it. */
function useTodayPullRequests() {
  const account = useBitbucketAccount();
  const query = usePullRequests(useLinkedRepos(), true);
  const me = account?.uuid ?? "";
  const mine = query.data?.filter((p) => p.role === "mine");
  const waiting = query.data?.filter((p) => p.role === "review" && myReview(p, me) === "waiting");
  return { account, mine, waiting };
}

/** Today: my open pull requests, and review requests still waiting for me (as in the sidebar). */
export function BitbucketTodayCards() {
  const { account, mine, waiting } = useTodayPullRequests();
  if (!account) return null;
  return (
    <>
      <TodayCard icon={GitPullRequest} label="My pull requests" count={mine?.length} detail="open" target={overview} testId="today-card-my-prs" />
      <TodayCard icon={Eye} label="Reviews" count={waiting?.length} detail="waiting for you" target={overview} testId="today-card-reviews" />
    </>
  );
}

/** Today: the review requests waiting for me, and my pull requests whose build failed. */
export function BitbucketTodaySection() {
  const { account, mine = [], waiting = [] } = useTodayPullRequests();
  const builds = useBuildsOf(mine);
  if (!account) return null;
  const failing = mine.filter((_, i) => summarizeBuilds(builds[i] ?? []) === "failed");
  const rows = (prs: typeof mine) => prs.map((p) => <PullRequestRow key={prRef(p)} pr={p} />);
  return (
    <div className="@container">
      <TodayList title="Waiting for your review" rows={rows(waiting)} target={overview} testId="today-reviews" />
      <TodayList title="Your pull requests with a failed build" rows={rows(failing)} target={overview} testId="today-failed-builds" />
    </div>
  );
}
