import { createFolder, createNote, listNotes } from "@/data/notes";
import { createTodo, linkNote } from "@/data/todos";
import { saveNote } from "@/data/noteSave";
import { addDaysStr, todayStr } from "@/lib/dates";
import { presetToRRule } from "@/lib/recurrence";

/** Seed text has no editor to add todo markers, so let saveNote assign them. */
const saveSeed = (id: string, body: string) => saveNote(id, body, { assignIds: true });

/** Sample content for the browser demo (the desktop app starts empty). */
export async function seedDemo() {
  if ((await listNotes()).length) return;
  const today = todayStr();

  const acme = await createFolder("", "Acme migration");
  await createFolder("Acme migration", "Meetings");
  const internal = await createFolder("", "Internal");

  const kickoff = await createNote("Acme migration/Meetings", "Kickoff 2026-09-22");
  await saveSeed(
    kickoff.id,
    [
      "## Attendees",
      "Anna (Acme), Jeroen, me",
      "",
      "## Notes",
      "- Go-live target is **end of Q4**",
      "- Budget approved, see [[Project plan]]",
      "",
      "## Action items",
      "- [ ] Send data export template to Anna",
      "- [ ] Book follow-up meeting",
      "- [x] Share slides",
    ].join("\n"),
  );

  const plan = await createNote("Acme migration", "Project plan");
  await saveSeed(
    plan.id,
    [
      "## Phases",
      "",
      "| Phase | Owner | Date |",
      "| --- | --- | --- |",
      "| Inventory | Jeroen | Oct |",
      "| Migration | Me | Nov |",
      "| Go-live | All | Dec |",
      "",
      "```sql",
      "select count(*) from customers where migrated = 0;",
      "```",
    ].join("\n"),
  );

  const oneOnOne = await createNote("Internal", "1-on-1 notes");
  await saveSeed(oneOnOne.id, "Topics for next time:\n\n- Training budget\n- Holiday planning");

  const t1 = await createTodo({ title: "Review migration script", priority: 1, dueDate: today, dueTime: "14:00", folderId: acme.id, estimateMin: 60 });
  await linkNote(t1.id, plan.id);
  await linkNote(t1.id, kickoff.id);
  await createTodo({ title: "Test on staging", parentId: t1.id, folderId: acme.id });
  await createTodo({ title: "Check rollback", parentId: t1.id, folderId: acme.id });

  const t2 = await createTodo({ title: "Write weekly status update", priority: 2, dueDate: today, rrule: presetToRRule("weekly", today), folderId: internal.id });
  await createTodo({ title: "Progress", parentId: t2.id, folderId: internal.id });
  await createTodo({ title: "Risks", parentId: t2.id, folderId: internal.id });
  await createTodo({ title: "Expense report", priority: 3, dueDate: addDaysStr(today, -2) });
  await createTodo({ title: "Prepare demo for Acme", priority: 2, startDate: addDaysStr(today, 2), dueDate: addDaysStr(today, 5), folderId: acme.id, status: "in_progress" });
  await createTodo({ title: "Waiting on license key from IT", status: "waiting", dueDate: addDaysStr(today, 1) });
  await createTodo({ title: "Read architecture RFC" });
  await createTodo({ title: "Team lunch", dueDate: addDaysStr(today, 3), dueTime: "12:00", folderId: internal.id });
}
