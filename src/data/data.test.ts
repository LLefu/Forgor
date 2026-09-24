import { beforeEach, describe, expect, it } from "vitest";
import { MemoryVault, SqlJsDriver } from "@/platform/memory";
import { setCtx } from "./context";
import { migrate, MIGRATIONS } from "./schema";
import * as notes from "./notes";
import * as todos from "./todos";
import { saveNote } from "./noteSave";
import { listTrash, listVersions, purgeTrashItem, restoreTrashItem, restoreVersion } from "./history";
import { search, toFtsQuery, EMPTY_FILTERS } from "./search";
import { loadSettings, saveSetting } from "./settings";
import { parseNote } from "@/lib/frontmatter";
import { todayStr, addDaysStr } from "@/lib/dates";
import { presetToRRule } from "@/lib/recurrence";

let vault: MemoryVault;
let sql: SqlJsDriver;

beforeEach(async () => {
  sql = await SqlJsDriver.create();
  vault = new MemoryVault();
  setCtx({ sql, vault });
  await migrate(sql);
});

describe("migrations & settings", () => {
  it("v2 turns checklist items into subtasks", async () => {
    const fresh = await SqlJsDriver.create();
    for (const stmt of MIGRATIONS[0]) await fresh.execute(stmt);
    await fresh.execute(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    await fresh.execute(`INSERT INTO meta VALUES ('schema_version', '1')`);
    await fresh.execute(`INSERT INTO todos (id, title, created_at, updated_at, folder_id) VALUES ('p', 'Parent', 't', 't', 'f1')`);
    await fresh.execute(`INSERT INTO checklist_items (id, todo_id, text, done, sort_order) VALUES ('c1', 'p', 'First', 1, 1), ('c2', 'p', 'Second', 0, 2)`);
    await migrate(fresh);
    setCtx({ sql: fresh, vault });
    const subs = await todos.listSubtasks("p");
    expect(subs.map((t) => [t.title, t.status, t.folderId])).toEqual([["First", "done", "f1"], ["Second", "todo", "f1"]]);
    const hits = await search("second");
    expect(hits.todos.map((h) => h.todo.id)).toEqual(["c2"]);
  });

  it("is idempotent and stores settings", async () => {
    await migrate(sql);
    await saveSetting(sql, "archiveAfterDays", 3);
    expect((await loadSettings(sql)).archiveAfterDays).toBe(3);
  });
});

describe("vault sync", () => {
  it("indexes external files and assigns ids", async () => {
    await vault.writeText("Clients/Acme/Kickoff.md", "# Kickoff\nBudget talk");
    await vault.mkdir("Empty");
    await notes.syncVault();
    const list = await notes.listNotes();
    expect(list.map((n) => [n.path, n.title])).toEqual([["Clients/Acme/Kickoff.md", "Kickoff"]]);
    expect((await notes.listFolders()).map((f) => f.path)).toEqual(["Clients", "Clients/Acme", "Empty"]);
    const written = parseNote(await vault.readText("Clients/Acme/Kickoff.md"));
    expect(written.data.id).toBe(list[0].id);
    expect(written.body).toContain("Budget talk");
  });

  it("gives duplicated files a new id and drops deleted files", async () => {
    await vault.writeText("A.md", "---\nid: same\n---\nA");
    await vault.writeText("B.md", "---\nid: same\n---\nB");
    await notes.syncVault();
    const ids = (await notes.listNotes()).map((n) => n.id);
    expect(new Set(ids).size).toBe(2);
    await vault.remove("A.md");
    await notes.syncVault();
    expect((await notes.listNotes()).map((n) => n.path)).toEqual(["B.md"]);
  });

  it("ignores .trash and _attachments", async () => {
    await vault.writeText(".trash/x/old.md", "old");
    await vault.writeText("A/_attachments/readme.md", "x");
    await notes.syncVault();
    expect(await notes.listNotes()).toEqual([]);
  });
});

describe("note & folder CRUD", () => {
  it("creates unique names, renames and moves", async () => {
    const f = await notes.createFolder("", "Project");
    const n1 = await notes.createNote("Project");
    const n2 = await notes.createNote("Project");
    expect([n1.path, n2.path]).toEqual(["Project/Untitled.md", "Project/Untitled 2.md"]);
    expect(n1.folderId).toBe(f.id);

    const renamed = await notes.renameNote(n1.id, "Plan: v1");
    expect(renamed!.path).toBe("Project/Plan- v1.md");
    expect(await vault.exists("Project/Plan- v1.md")).toBe(true);

    const moved = await notes.moveNote(n2.id, "");
    expect(moved!.path).toBe("Untitled 2.md");
  });

  it("renaming a folder keeps folder ids and updates note paths", async () => {
    const f = await notes.createFolder("", "Old");
    const sub = await notes.createFolder("Old", "Sub");
    const n = await notes.createNote("Old/Sub", "Deep");
    const t = await todos.createTodo({ title: "in folder", folderId: f.id });
    await notes.relocateFolder(f.id, "New");
    expect((await notes.listFolders()).map((x) => [x.id, x.path])).toEqual([
      [f.id, "New"],
      [sub.id, "New/Sub"],
    ]);
    expect((await notes.getNoteMeta(n.id))!.path).toBe("New/Sub/Deep.md");
    await notes.syncVault(); // nothing should be lost after a full resync
    expect((await todos.getTodo(t.id))!.folderId).toBe(f.id);
    expect((await notes.getNoteMeta(n.id))!.path).toBe("New/Sub/Deep.md");
  });

  it("preserves custom frontmatter on save", async () => {
    await vault.writeText("N.md", "---\nid: n1\ntags: keep\n---\nold");
    await notes.syncVault();
    await saveNote("n1", "new body");
    const p = parseNote(await vault.readText("N.md"));
    expect(p.data).toMatchObject({ id: "n1", tags: "keep" });
    expect(p.body).toBe("new body");
  });

  it("saves attachments next to the note", async () => {
    await notes.createFolder("", "P");
    const n = await notes.createNote("P", "Note");
    const { rel, path } = await notes.saveAttachment(n.id, "screen shot.png", new Uint8Array([1, 2, 3]));
    expect(path).toBe("P/_attachments/screen shot.png");
    expect(rel).toBe("_attachments/screen%20shot.png");
  });

  it("moving a note takes its attachments along", async () => {
    await notes.createFolder("", "A");
    await notes.createFolder("", "B");
    const n = await notes.createNote("A", "Pics");
    const { rel } = await notes.saveAttachment(n.id, "shot.png", new Uint8Array([9]));
    await saveNote(n.id, `![shot](${rel}) and [site](https://example.com)`);
    await notes.moveNote(n.id, "B");
    expect(await vault.exists("B/_attachments/shot.png")).toBe(true);
    expect(await vault.exists("A/_attachments/shot.png")).toBe(false);
    expect((await notes.readNote(n.id))!.body).toBe("![shot](_attachments/shot.png) and [site](https://example.com)");
  });

  it("computes backlinks from wiki links", async () => {
    const target = await notes.createNote("", "Roadmap");
    const src = await notes.createNote("", "Weekly");
    await saveNote(src.id, "See [[roadmap]] for details");
    expect((await notes.backlinks(target.id)).map((n) => n.title)).toEqual(["Weekly"]);
  });
});

describe("todos", () => {
  it("completing a recurring todo spawns the next occurrence", async () => {
    const today = todayStr();
    const t = await todos.createTodo({ title: "Standup", dueDate: today, dueTime: "09:30", rrule: presetToRRule("daily", today) });
    const sub = await todos.createTodo({ title: "notes", parentId: t.id });
    await todos.setDone(sub.id, true);
    await todos.setDone(t.id, true);
    const all = await todos.listTodos();
    const next = all.find((x) => x.id !== t.id && !x.parentId && x.status === "todo")!;
    expect(next.dueDate).toBe(addDaysStr(today, 1));
    expect(next.dueTime).toBe("09:30");
    expect(next.status).toBe("todo");
    // subtasks are copied, reset to not-done
    expect((await todos.listSubtasks(next.id)).map((c) => [c.title, c.status])).toEqual([["notes", "todo"]]);
    expect((await todos.getTodo(t.id))!.rrule).toBeNull();
    expect((await todos.getTodo(t.id))!.completedAt).not.toBeNull();
  });

  it("clearing due date clears time; subtasks are counted", async () => {
    const t = await todos.createTodo({ title: "Parent", dueDate: "2026-10-01", dueTime: "10:00" });
    await todos.updateTodo(t.id, { dueDate: null });
    expect((await todos.getTodo(t.id))!.dueTime).toBeNull();
    const s = await todos.createTodo({ title: "Child", parentId: t.id });
    await todos.createTodo({ title: "Child 2", parentId: t.id });
    await todos.setDone(s.id, true);
    const p = (await todos.getTodo(t.id))!;
    expect([p.subtaskCount, p.subtaskDone]).toEqual([2, 1]);
  });

  it("archives completed todos after N days", async () => {
    const t = await todos.createTodo({ title: "Old" });
    await todos.setDone(t.id, true);
    expect(await todos.archiveCompleted(7)).toBe(0);
    const later = new Date(Date.now() + 8 * 86400_000);
    expect(await todos.archiveCompleted(7, later)).toBe(1);
    expect((await todos.listTodos()).length).toBe(0);
    expect((await todos.listArchived()).map((x) => x.title)).toEqual(["Old"]);
  });

  it("links notes many-to-many and counts them", async () => {
    const a = await notes.createNote("", "A");
    const b = await notes.createNote("", "B");
    const t1 = await todos.createTodo({ title: "T1" });
    const t2 = await todos.createTodo({ title: "T2" });
    await todos.linkNote(t1.id, a.id);
    await todos.linkNote(t1.id, b.id);
    await todos.linkNote(t2.id, a.id);
    expect((await todos.getTodo(t1.id))!.noteCount).toBe(2);
    expect((await todos.todosForNote(a.id)).map((t) => t.title).sort()).toEqual(["T1", "T2"]);
    await todos.unlinkNote(t1.id, b.id);
    expect((await todos.notesForTodo(t1.id)).map((n) => n.title)).toEqual(["A"]);
  });
});

describe("inline todos", () => {
  it("creates todos from task lines and syncs both ways", async () => {
    const n = await notes.createNote("", "Meeting");
    const body = await saveNote(n.id, "# Actions\n- [ ] Send report\n- [x] Book room", { assignIds: true });
    const created = await todos.todosForNote(n.id);
    expect(created.map((t) => [t.title, t.status, t.sourceNoteId]).sort()).toEqual([
      ["Book room", "done", n.id],
      ["Send report", "todo", n.id],
    ]);
    expect(body).toMatch(/- \[ \] Send report \^t-[a-z0-9]+/);

    // App → note
    const report = created.find((t) => t.title === "Send report")!;
    await todos.setDone(report.id, true);
    expect((await notes.readNote(n.id))!.body).toContain(`- [x] Send report ^t-${report.id}`);
    await todos.updateTodo(report.id, { title: "Send final report" });
    expect((await notes.readNote(n.id))!.body).toContain(`Send final report ^t-${report.id}`);

    // Note → app
    const current = (await notes.readNote(n.id))!.body;
    await saveNote(n.id, current.replace(`- [x] Send final report`, `- [ ] Send the report`));
    const t = (await todos.getTodo(report.id))!;
    expect([t.title, t.status]).toEqual(["Send the report", "todo"]);
  });
});

describe("inline todos: editor save sequence", () => {
  it("does not duplicate a todo when the editor adds its marker after the first save", async () => {
    const n = await notes.createNote("", "Race");
    // 1. autosave fires before the editor has added a marker
    await saveNote(n.id, "- [ ] Call Jan");
    // 2. editor adds its own marker, next autosave
    await saveNote(n.id, "- [ ] Call Jan ^t-editor1");
    // 3. user keeps typing
    await saveNote(n.id, "- [ ] Call Jan ^t-editor1\n- [ ] ");
    const all = await todos.todosForNote(n.id);
    expect(all.map((t) => [t.id, t.title])).toEqual([["editor1", "Call Jan"]]);
  });

  it("ignores empty task lines the editor saves as <br />", async () => {
    const n = await notes.createNote("", "Empty");
    await saveNote(n.id, "- [ ] <br />\n* [ ] <br /> ^t-empty1");
    expect(await todos.todosForNote(n.id)).toEqual([]);
  });
});

describe("search", () => {
  it("builds safe FTS queries", () => {
    expect(toFtsQuery(`budget "q3" OR`)).toBe(`"budget*" "q3*"`);
    expect(toFtsQuery("   ")).toBeNull();
  });

  it("finds notes and todos with filters", async () => {
    await notes.createFolder("", "Acme");
    const n = await notes.createNote("Acme", "Kickoff");
    await saveNote(n.id, "We discussed the budget for Q3");
    await todos.createTodo({ title: "Prepare budget sheet", priority: 1, dueDate: "2026-10-01" });
    await todos.createTodo({ title: "Unrelated", priority: 1 });

    const r = await search("budg");
    expect(r.notes.map((h) => h.note.title)).toEqual(["Kickoff"]);
    expect(r.notes[0].snippet).toContain("\u0001budget\u0002");
    expect(r.todos.map((h) => h.todo.title)).toEqual(["Prepare budget sheet"]);

    const onlyP1 = await search("", { ...EMPTY_FILTERS, priority: 1 });
    expect(onlyP1.todos.length).toBe(2);
    const inFolder = await search("budget", { ...EMPTY_FILTERS, folderPath: "Acme" });
    expect(inFolder.notes.length).toBe(1);
    expect(inFolder.todos.length).toBe(0);
  });
});

describe("trash & versions", () => {
  it("trashes and restores notes, keeping todo links", async () => {
    const n = await notes.createNote("", "Temp");
    const t = await todos.createTodo({ title: "linked" });
    await todos.linkNote(t.id, n.id);
    await notes.trashNote(n.id);
    expect(await notes.listNotes()).toEqual([]);
    expect((await todos.getTodo(t.id))!.noteCount).toBe(0);
    const [item] = await listTrash();
    await restoreTrashItem(item.id);
    expect((await notes.listNotes()).map((x) => x.id)).toEqual([n.id]);
    expect((await todos.getTodo(t.id))!.noteCount).toBe(1);
  });

  it("trashes folders and purges permanently", async () => {
    await notes.createFolder("", "Gone");
    await notes.createNote("Gone", "Inside");
    const f = (await notes.listFolders())[0];
    await notes.trashFolder(f.id);
    expect(await notes.listFolders()).toEqual([]);
    const [item] = await listTrash();
    await purgeTrashItem(item.id);
    expect(await listTrash()).toEqual([]);
    expect((await vault.list()).filter((e) => !e.isDir)).toEqual([]);
  });

  it("deletes and restores todos with subtasks", async () => {
    const p = await todos.createTodo({ title: "P" });
    await todos.createTodo({ title: "C", parentId: p.id });
    await todos.deleteTodo(p.id);
    expect(await todos.listTodos()).toEqual([]);
    const [item] = await listTrash();
    await restoreTrashItem(item.id);
    expect((await todos.listTodos()).length).toBe(2);
  });

  it("snapshots and restores versions", async () => {
    const n = await notes.createNote("", "V");
    await saveNote(n.id, "first");
    await saveNote(n.id, "second"); // snapshot of "first"
    const versions = await listVersions(n.id);
    expect(versions.map((v) => v.content)).toEqual(["first"]);
    await restoreVersion(versions[0]);
    expect((await notes.readNote(n.id))!.body).toBe("first");
    expect((await listVersions(n.id)).map((v) => v.content)).toContain("second");
  });
});
