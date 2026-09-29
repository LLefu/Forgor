import { describe, expect, it } from "vitest";
import { groupTasks } from "./taskSort";
import { effectiveFolderColor, colorHex } from "./folderColors";
import { parseTime } from "@/components/DateTimePickers";
import type { Folder, Todo } from "@/data/types";

const today = "2026-09-29";
let n = 0;
function todo(p: Partial<Todo>): Todo {
  n++;
  return {
    id: `t${n}`, title: `Task ${n}`, description: "", status: "todo", priority: 4, dueDate: null, dueTime: null, startDate: null,
    estimateMin: null, rrule: null, recurFromCompletion: false, parentId: null, folderId: null, sortOrder: n,
    createdAt: `2026-09-${String(n).padStart(2, "0")}T00:00:00Z`, updatedAt: "", completedAt: null, archivedAt: null,
    deletedAt: null, sourceNoteId: null, noteCount: 0, subtaskCount: 0, subtaskDone: 0, ...p,
  };
}

const folders: Folder[] = [
  { id: "a", path: "Acme", color: "blue" },
  { id: "a1", path: "Acme/Meetings", color: null },
  { id: "a2", path: "Acme/Design", color: "pink" },
  { id: "b", path: "Beta", color: null },
];

describe("groupTasks", () => {
  const list = [
    todo({ title: "late", dueDate: "2026-09-20", priority: 2 }),
    todo({ title: "now", dueDate: today, priority: 1, folderId: "a" }),
    todo({ title: "tmrw", dueDate: "2026-09-30", folderId: "b" }),
    todo({ title: "week", dueDate: "2026-10-03" }),
    todo({ title: "far", dueDate: "2026-12-01", priority: 1, folderId: "a1" }),
    todo({ title: "someday", priority: 3 }),
    todo({ title: "child", parentId: "x", dueDate: today }),
  ];
  const view = (sort: Parameters<typeof groupTasks>[1]) =>
    groupTasks(list, sort, folders, today).map((g) => [g.title, g.todos.map((t) => t.title)]);

  it("by due date: overdue → today → tomorrow → next 7 days → later → no date; subtasks excluded", () => {
    expect(view("due")).toEqual([
      ["Overdue", ["late"]],
      ["Today", ["now"]],
      ["Tomorrow", ["tmrw"]],
      ["Next 7 days", ["week"]],
      ["Later", ["far"]],
      ["No date", ["someday"]],
    ]);
  });
  it("by priority, then due date", () => {
    expect(view("priority")).toEqual([
      ["P1 · Urgent", ["now", "far"]],
      ["P2 · High", ["late"]],
      ["P3 · Medium", ["someday"]],
      ["P4 · None", ["tmrw", "week"]],
    ]);
  });
  it("by folder: inbox first, then folder paths", () => {
    expect(view("folder")).toEqual([
      ["Inbox (no folder)", ["late", "week", "someday"]],
      ["Acme", ["now"]],
      ["Acme/Meetings", ["far"]],
      ["Beta", ["tmrw"]],
    ]);
  });
  it("flat sorts: newest first and title", () => {
    expect(view("created")[0][1]).toEqual(["someday", "far", "week", "tmrw", "now", "late"]);
    expect(view("title")[0][1]).toEqual(["far", "late", "now", "someday", "tmrw", "week"]);
  });
});

describe("folder colors", () => {
  it("uses the folder's own color, else the nearest ancestor's", () => {
    expect(effectiveFolderColor("a", folders)).toBe(colorHex("blue"));
    expect(effectiveFolderColor("a1", folders)).toBe(colorHex("blue")); // inherited
    expect(effectiveFolderColor("a2", folders)).toBe(colorHex("pink")); // own wins
    expect(effectiveFolderColor("b", folders)).toBeNull();
    expect(effectiveFolderColor(null, folders)).toBeNull();
  });
});

describe("parseTime", () => {
  it("accepts common formats", () => {
    expect(parseTime("9")).toBe("09:00");
    expect(parseTime("930")).toBe("09:30");
    expect(parseTime("9:30")).toBe("09:30");
    expect(parseTime("21.05")).toBe("21:05");
    expect(parseTime("9pm")).toBe("21:00");
    expect(parseTime("12am")).toBe("00:00");
    expect(parseTime("12:15pm")).toBe("12:15");
  });
  it("rejects nonsense", () => {
    expect(parseTime("25:00")).toBeNull();
    expect(parseTime("9:75")).toBeNull();
    expect(parseTime("soon")).toBeNull();
  });
});
