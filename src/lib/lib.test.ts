import { describe, expect, it } from "vitest";
import { bucketTodos, friendlyDate, shouldArchive, formatEstimate } from "./dates";
import { nextOccurrence, presetToRRule, customRRule, describeRRule, occurrences } from "./recurrence";
import { parseNote, stringifyNote } from "./frontmatter";
import { assignTaskIds, parseTasks, setTaskChecked, setTaskText } from "./inlineTodos";
import { extractWikiLinks, resolveWikiTarget } from "./wikilinks";
import { cleanMarkdown } from "./markdown";
import { isIgnoredPath, relativePath, resolvePath, sanitizeName, uniqueName } from "./paths";
import type { Todo } from "@/data/types";

function todo(p: Partial<Todo>): Todo {
  return {
    id: Math.random().toString(36).slice(2),
    title: "t",
    description: "",
    status: "todo",
    priority: 4,
    dueDate: null,
    dueTime: null,
    startDate: null,
    estimateMin: null,
    rrule: null,
    recurFromCompletion: false,
    parentId: null,
    folderId: null,
    sortOrder: 0,
    createdAt: "",
    updatedAt: "",
    completedAt: null,
    archivedAt: null,
    deletedAt: null,
    sourceNoteId: null,
    noteCount: 0,
    subtaskCount: 0,
    subtaskDone: 0,
    ...p,
  };
}

describe("bucketTodos", () => {
  const today = "2026-09-24";
  it("splits overdue, today and upcoming", () => {
    const b = bucketTodos(
      [
        todo({ title: "late", dueDate: "2026-09-20" }),
        todo({ title: "now", dueDate: today }),
        todo({ title: "started", startDate: "2026-09-22", dueDate: "2026-10-01" }),
        todo({ title: "future-start", startDate: "2026-09-26", dueDate: "2026-09-30" }),
        todo({ title: "tomorrow", dueDate: "2026-09-25" }),
        todo({ title: "far", dueDate: "2026-12-01" }),
        todo({ title: "done", dueDate: today, status: "done" }),
        todo({ title: "sub", dueDate: today, parentId: "x" }),
        todo({ title: "nodate" }),
      ],
      today,
      7,
    );
    expect(b.overdue.map((t) => t.title)).toEqual(["late"]);
    expect(b.today.map((t) => t.title).sort()).toEqual(["now", "started"]);
    expect(b.upcoming.map((g) => [g.date, g.todos.map((t) => t.title)])).toEqual([
      ["2026-09-25", ["tomorrow"]],
      ["2026-09-26", ["future-start"]],
    ]);
  });

  it("orders timed items first, then by priority", () => {
    const b = bucketTodos(
      [
        todo({ title: "p1", dueDate: today, priority: 1 }),
        todo({ title: "late-time", dueDate: today, dueTime: "15:00" }),
        todo({ title: "early-time", dueDate: today, dueTime: "09:00" }),
        todo({ title: "p3", dueDate: today, priority: 3 }),
      ],
      today,
      7,
    );
    expect(b.today.map((t) => t.title)).toEqual(["early-time", "late-time", "p1", "p3"]);
  });
});

describe("dates helpers", () => {
  it("friendlyDate", () => {
    expect(friendlyDate("2026-09-24", "2026-09-24")).toBe("Today");
    expect(friendlyDate("2026-09-25", "2026-09-24")).toBe("Tomorrow");
    expect(friendlyDate("2026-09-23", "2026-09-24")).toBe("Yesterday");
    expect(friendlyDate("2026-09-28", "2026-09-24")).toBe("Monday");
    expect(friendlyDate("2026-11-02", "2026-09-24")).toBe("2 Nov");
    expect(friendlyDate("2027-01-02", "2026-09-24")).toBe("2 Jan 2027");
  });
  it("shouldArchive after N days only for completed todos", () => {
    const now = new Date("2026-09-24T12:00:00Z");
    expect(shouldArchive(todo({ status: "done", completedAt: "2026-09-16T12:00:00Z" }), now, 7)).toBe(true);
    expect(shouldArchive(todo({ status: "done", completedAt: "2026-09-20T12:00:00Z" }), now, 7)).toBe(false);
    expect(shouldArchive(todo({ status: "todo", completedAt: "2026-09-01T12:00:00Z" }), now, 7)).toBe(false);
  });
  it("formatEstimate", () => {
    expect(formatEstimate(30)).toBe("30m");
    expect(formatEstimate(90)).toBe("1h 30m");
    expect(formatEstimate(120)).toBe("2h");
    expect(formatEstimate(null)).toBe("");
  });
});

describe("recurrence", () => {
  it("daily / weekdays / monthly next occurrence", () => {
    expect(nextOccurrence(presetToRRule("daily")!, "2026-09-24")).toBe("2026-09-25");
    // 2026-09-25 is a Friday → next weekday is Monday 28th
    expect(nextOccurrence(presetToRRule("weekdays")!, "2026-09-25")).toBe("2026-09-28");
    expect(nextOccurrence(presetToRRule("monthly", "2026-01-31")!, "2026-01-31")).toBe("2026-03-31");
    expect(nextOccurrence(presetToRRule("weekly", "2026-09-24")!, "2026-09-24")).toBe("2026-10-01");
    expect(nextOccurrence(presetToRRule("biweekly", "2026-09-24")!, "2026-09-24")).toBe("2026-10-08");
  });
  it("custom every 3 days", () => {
    expect(nextOccurrence(customRRule(3, "day"), "2026-09-24")).toBe("2026-09-27");
  });
  it("occurrences within a range", () => {
    expect(occurrences(presetToRRule("daily")!, "2026-09-24", "2026-09-27")).toEqual([
      "2026-09-24",
      "2026-09-25",
      "2026-09-26",
      "2026-09-27",
    ]);
  });
  it("describes rules", () => {
    expect(describeRRule(presetToRRule("daily"))).toBe("Every day");
    expect(describeRRule(null)).toBe("Does not repeat");
  });
});

describe("frontmatter", () => {
  it("round-trips and preserves unknown fields", () => {
    const text = "---\nid: abc\ncustom: yes\n---\n\n# Hello\n";
    const p = parseNote(text);
    expect(p.data).toEqual({ id: "abc", custom: "yes" });
    expect(p.body).toBe("# Hello\n");
    expect(stringifyNote(p.data, p.body)).toBe("---\nid: abc\ncustom: yes\n---\n\n# Hello\n");
  });
  it("files without frontmatter are all body", () => {
    expect(parseNote("# Hi")).toEqual({ data: {}, body: "# Hi" });
  });
  it("malformed frontmatter keeps content", () => {
    const text = "---\n: : bad: [\n---\nbody";
    expect(parseNote(text).body).toBe(text);
  });
});

describe("inline todos", () => {
  const md = ["# Meeting", "- [ ] Call Jan", "* [x] Done thing ^t-abc123", "```", "- [ ] not a task", "```", "- [ ]   "].join("\n");

  it("parses tasks outside code fences", () => {
    expect(parseTasks(md)).toEqual([
      { lineIndex: 1, checked: false, text: "Call Jan", todoId: null },
      { lineIndex: 2, checked: true, text: "Done thing", todoId: "abc123" },
    ]);
  });
  it("assigns ids to new tasks only", () => {
    const { md: out, created } = assignTaskIds(md, () => "new1");
    expect(created).toEqual([{ id: "new1", text: "Call Jan", checked: false }]);
    expect(out.split("\n")[1]).toBe("- [ ] Call Jan ^t-new1");
    expect(out.split("\n")[4]).toBe("- [ ] not a task");
  });
  it("sets checked state and text by id", () => {
    expect(setTaskChecked(md, "abc123", false)!.split("\n")[2]).toBe("* [ ] Done thing ^t-abc123");
    expect(setTaskChecked(md, "abc123", true)).toBeNull();
    expect(setTaskText(md, "abc123", "Renamed")!.split("\n")[2]).toBe("* [x] Renamed ^t-abc123");
  });
});

describe("wikilinks", () => {
  it("extracts targets", () => {
    expect(extractWikiLinks("See [[Plan]] and [[Clients/Acme|Acme]] and [[Plan#Goals]]")).toEqual(["Plan", "Clients/Acme"]);
  });
  it("resolves by path then title", () => {
    const notes = [
      { id: "1", path: "Plan.md", title: "Plan" },
      { id: "2", path: "Clients/Acme.md", title: "Acme" },
    ];
    expect(resolveWikiTarget("plan", notes)).toBe("1");
    expect(resolveWikiTarget("Clients/Acme", notes)).toBe("2");
    expect(resolveWikiTarget("Acme", notes)).toBe("2");
    expect(resolveWikiTarget("Nope", notes)).toBeNull();
  });
});

describe("cleanMarkdown", () => {
  it("drops empty-paragraph <br /> lines outside code blocks", () => {
    const md = ["Intro", "", "<br />", "", "Next", "```", "<br />", "```"].join("\n");
    expect(cleanMarkdown(md)).toBe(["Intro", "", "Next", "```", "<br />", "```"].join("\n"));
  });
});

describe("paths", () => {
  it("ignores hidden and attachment folders", () => {
    expect(isIgnoredPath(".trash/x.md")).toBe(true);
    expect(isIgnoredPath("A/_attachments/img.png")).toBe(true);
    expect(isIgnoredPath("A/B/note.md")).toBe(false);
  });
  it("sanitizes names", () => {
    expect(sanitizeName('a/b:c*?"d')).toBe("a-b-c---d");
    expect(sanitizeName("  ")).toBe("Untitled");
    expect(sanitizeName("name. ")).toBe("name");
  });
  it("finds unique names", async () => {
    const taken = new Set(["A/Untitled.md", "A/Untitled 2.md"]);
    expect(await uniqueName("A", "Untitled", ".md", async (p) => taken.has(p))).toBe("A/Untitled 3.md");
  });
  it("relative and resolve paths", () => {
    expect(relativePath("A/B", "A/_attachments/x.png")).toBe("../_attachments/x.png");
    expect(relativePath("A", "A/_attachments/x.png")).toBe("_attachments/x.png");
    expect(resolvePath("A/B", "../_attachments/x%20y.png")).toBe("A/_attachments/x y.png");
  });
});
