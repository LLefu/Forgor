import { beforeEach, describe, expect, it } from "vitest";
import { MemoryVault, SqlJsDriver } from "@/platform/memory";
import { setCtx } from "./context";
import { migrate } from "./schema";
import * as notes from "./notes";
import * as meetings from "./meetings";
import { search } from "./search";
import { PROCESSING_PLACEHOLDER } from "@/lib/meetingNote";
import type { RecordingInfo } from "@/platform/meetings";

let vault: MemoryVault;

beforeEach(async () => {
  const sql = await SqlJsDriver.create();
  vault = new MemoryVault();
  setCtx({ sql, vault });
  await migrate(sql);
});

const info: RecordingInfo = { id: "1790000000000", startedAt: new Date(2026, 8, 30, 14, 5).getTime(), durationSec: 125, systemAudio: true };

describe("meeting recordings", () => {
  it("start unassigned in .meetings: indexed and searchable, but not a folder", async () => {
    const m = await meetings.createMeeting(info);
    expect(m.note?.path).toBe(".meetings/Meeting 30 Sep 14.05.md");
    expect(m.folderId).toBeNull();
    expect(m.status).toBe("processing");
    expect(await vault.readText(m.note!.path)).toContain(PROCESSING_PLACEHOLDER);
    expect(await notes.listFolders()).toEqual([]); // .meetings is not a folder in the app

    await meetings.completeMeeting(info.id, {
      language: "nl",
      segments: [{ start: 0, end: 3, speaker: "others", text: "We verplaatsen de lancering" }],
      summary: "## Samenvatting\nDe lancering schuift op.",
      summaryError: null,
    });
    const done = (await meetings.getMeeting(info.id))!;
    expect(done.status).toBe("done");
    const body = (await notes.readNote(done.noteId!))!.body;
    expect(body).toContain("## Samenvatting");
    expect(body).toContain("**[00:00] Anderen:** We verplaatsen de lancering");
    expect(body).not.toContain(PROCESSING_PLACEHOLDER);
    expect((await search("lancering")).notes.map((h) => h.note.id)).toEqual([done.noteId]);

    // A fresh index (e.g. another window) still finds it
    await notes.syncVault();
    expect((await notes.listNotes()).map((n) => n.path)).toEqual([".meetings/Meeting 30 Sep 14.05.md"]);
    expect(await notes.listFolders()).toEqual([]);
  });

  it("are named and moved into a folder, and back", async () => {
    const folder = await notes.createFolder("", "Boerhaave");
    await meetings.createMeeting(info);
    await meetings.nameAndAssign(info.id, "Kick-off", folder.id);
    let m = (await meetings.getMeeting(info.id))!;
    expect(m.note?.path).toBe("Boerhaave/Kick-off.md");
    expect(m.folderId).toBe(folder.id);

    await meetings.assignFolder(info.id, null);
    m = (await meetings.getMeeting(info.id))!;
    expect(m.note?.path).toBe(".meetings/Kick-off.md");
    expect(m.folderId).toBeNull();
  });

  it("creating the same recording twice keeps one note; deleting trashes it", async () => {
    await meetings.createMeeting(info);
    await meetings.createMeeting(info);
    expect(await notes.listNotes()).toHaveLength(1);
    await meetings.deleteMeeting(info.id);
    expect(await meetings.listMeetings()).toEqual([]);
    expect(await notes.listNotes()).toEqual([]);
  });

  it("failed processing keeps the recording for a retry", async () => {
    await meetings.createMeeting(info);
    await meetings.setStatus(info.id, "failed", "No microphone found");
    const m = (await meetings.getMeeting(info.id))!;
    expect([m.status, m.error]).toEqual(["failed", "No microphone found"]);
  });

  it("naming speakers rebuilds the transcript and summary, keeping the user's own text", async () => {
    await meetings.createMeeting(info);
    await meetings.completeMeeting(info.id, {
      language: "nl",
      segments: [
        { start: 0, end: 3, speaker: "others", speakerId: 1, text: "Wie is er nog niet geweest?" },
        { start: 4, end: 8, speaker: "others", speakerId: 2, text: "Ik pak de zoekpagina op" },
      ],
      summary: "## Actiepunten\n- Spreker 2: zoekpagina oppakken",
      summaryError: null,
    });
    let m = (await meetings.getMeeting(info.id))!;
    expect(meetings.hasSpeakers(m)).toBe(true);
    const own = "Mijn eigen aantekening";
    await notes.writeNoteBody(m.noteId!, `${own}\n\n${(await notes.readNote(m.noteId!))!.body}`);

    await meetings.nameSpeakers(info.id, { 2: " Germen ", 1: "" }, "## Actiepunten\n- Germen: zoekpagina oppakken");
    m = (await meetings.getMeeting(info.id))!;
    expect(m.speakers).toEqual({ 2: "Germen" });
    const body = (await notes.readNote(m.noteId!))!.body;
    expect(body.startsWith(own)).toBe(true);
    expect(body).toContain("**[00:04] Germen:** Ik pak de zoekpagina op");
    expect(body).toContain("**[00:00] Spreker 1:** Wie is er nog niet geweest?");
    expect(body).toContain("- Germen: zoekpagina oppakken");
    expect(body).not.toContain("Spreker 2");
    expect(await meetings.knownSpeakerNames()).toEqual(["Germen"]);

    // Transcribing again numbers the voices anew: the old names are dropped
    await meetings.completeMeeting(info.id, { ...m.result!, summary: null });
    expect((await meetings.getMeeting(info.id))!.speakers).toEqual({});
  });
});
