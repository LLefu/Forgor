import { describe, expect, it } from "vitest";
import { adfText, filterIssues, matchBoards, mediaAttachments, paths, sortIssues, toIssue, type JiraIssue } from "./jira";

const issue = (key: string, patch: Partial<JiraIssue> = {}): JiraIssue => ({
  key,
  summary: `Summary ${key}`,
  status: "To Do",
  statusCategory: "new",
  priority: "Medium",
  type: "Task",
  project: { key: key.split("-")[0], name: "" },
  assignee: null,
  reporter: null,
  created: "2026-10-01T10:00:00.000+0200",
  updated: "2026-10-01T10:00:00.000+0200",
  due: null,
  labels: [],
  description: null,
  attachments: [],
  ...patch,
});

describe("jira", () => {
  it("reads Jira's issue shape", () => {
    const i = toIssue({
      key: "WEB-1",
      fields: {
        summary: "Fix it",
        status: { name: "In Review", statusCategory: { key: "indeterminate" } },
        priority: { name: "High" },
        issuetype: { name: "Bug" },
        project: { key: "WEB", name: "Website" },
        assignee: { displayName: "Sanne" },
        duedate: "2026-10-20",
      },
    });
    expect(i).toMatchObject({ key: "WEB-1", summary: "Fix it", status: "In Review", statusCategory: "indeterminate", priority: "High", type: "Bug", assignee: "Sanne", due: "2026-10-20" });
    expect(toIssue({ key: "X-1", fields: {} })).toMatchObject({ statusCategory: "new", priority: null, project: { key: "X" } });
  });

  it("sorts by priority, due date and key", () => {
    const list = [issue("A-10", { priority: "Low", due: "2026-10-05" }), issue("A-9", { priority: "Highest" }), issue("A-2", { priority: "High", due: "2026-10-01" })];
    expect(sortIssues(list, "priority").map((i) => i.key)).toEqual(["A-9", "A-2", "A-10"]);
    expect(sortIssues(list, "due").map((i) => i.key)).toEqual(["A-2", "A-10", "A-9"]);
    expect(sortIssues(list, "key").map((i) => i.key)).toEqual(["A-2", "A-9", "A-10"]);
  });

  it("filters by text, project, status and priority", () => {
    const list = [issue("WEB-1", { summary: "Dark mode" }), issue("APP-2", { statusCategory: "done" }), issue("APP-3", { priority: "High" })];
    expect(filterIssues(list, { text: "dark" }).map((i) => i.key)).toEqual(["WEB-1"]);
    expect(filterIssues(list, { text: "app-3" }).map((i) => i.key)).toEqual(["APP-3"]);
    expect(filterIssues(list, { projects: ["APP"], categories: ["new"] }).map((i) => i.key)).toEqual(["APP-3"]);
    expect(filterIssues(list, { priorities: ["High"] }).map((i) => i.key)).toEqual(["APP-3"]);
  });

  it("encodes JQL into request paths", () => {
    expect(paths.search("assignee = currentUser()")).toContain("jql=assignee%20%3D%20currentUser()");
    expect(paths.boards(50)).toBe("/rest/agile/1.0/board?maxResults=50&startAt=50");
  });

  it("finds boards by board name, project name or key", () => {
    const b = (id: number, name: string, projectName: string, projectKey: string) => ({ id, name, projectName, projectKey });
    const boards = [b(1, "WEB board", "Website", "WEB"), b(2, "Sprint board", "Schadegarant", "SG"), b(3, "SG kanban", "Schadegarant", "SG")];
    expect(matchBoards(boards, "schadegarant").map((x) => x.id)).toEqual([3, 2]);
    expect(matchBoards(boards, "sg sprint").map((x) => x.id)).toEqual([2]);
    expect(matchBoards(boards, "").map((x) => x.id)).toEqual([3, 2, 1]);
  });

  it("finds the attachment of each image: by file name, else in order", () => {
    const a = (id: string, filename: string, mimeType = "image/png") => ({ id, filename, mimeType, size: 1 });
    const attachments = [a("1", "log.txt", "text/plain"), a("2", "first.png"), a("3", "shot.png")];
    const named = { type: "media", attrs: { alt: "shot.png" } };
    const unnamed = { type: "media", attrs: {} };
    const doc = { type: "doc", content: [{ type: "mediaSingle", content: [unnamed] }, { type: "mediaSingle", content: [named] }] };
    const map = mediaAttachments(doc, attachments, true);
    expect(map.get(named)?.id).toBe("3");
    expect(map.get(unnamed)?.id).toBe("2");
    expect(mediaAttachments(doc, attachments, false).has(unnamed)).toBe(false);
  });

  it("gets plain text from a document", () => {
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi " }, { type: "mention", attrs: { text: "@Tom" } }] }] };
    expect(adfText(doc)).toBe("Hi @Tom\n");
  });
});
