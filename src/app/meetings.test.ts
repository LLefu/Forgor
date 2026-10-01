import { beforeEach, describe, expect, it } from "vitest";
import { MemoryVault, SqlJsDriver } from "@/platform/memory";
import { setCtx } from "@/data/context";
import { migrate } from "@/data/schema";
import * as notes from "@/data/notes";
import { getMeeting, listMeetings } from "@/data/meetings";
import { meetings } from "@/platform/meetings";
import { processMeeting, startMeetings } from "./meetings";
import { useUI } from "./store";

beforeEach(async () => {
  const sql = await SqlJsDriver.create();
  setCtx({ sql, vault: new MemoryVault() });
  await migrate(sql);
});

const until = async (check: () => Promise<boolean>) => {
  for (let i = 0; i < 200 && !(await check()); i++) await new Promise((r) => setTimeout(r, 10));
};

describe("meeting processing (browser backend)", () => {
  it("processing the same recording twice runs once", async () => {
    const api = meetings();
    await api.download("speech");
    await api.start();
    const info = (await api.stop())!;
    const { createMeeting } = await import("@/data/meetings");
    await createMeeting(info);
    await Promise.all([processMeeting(info.id), processMeeting(info.id)]);
    const m = (await getMeeting(info.id))!;
    expect(m.status).toBe("done"); // not "failed: the audio is gone" from a second run
    expect((await notes.readNote(m.noteId!))!.body).toContain("Goedemorgen allemaal");
    expect(await api.recordings()).toEqual([]); // audio deleted after the note was written
  });

  it("picks up a recording that was never handled (quit or crash), once", async () => {
    const api = meetings();
    await api.download("speech");
    await api.start();
    const info = (await api.stop())!; // no listener: nothing handled it
    useUI.setState((s) => ({ settings: { ...s.settings, meetingsEnabled: true } }));
    const stops = [startMeetings(), startMeetings()]; // StrictMode runs effects twice
    await until(async () => (await getMeeting(info.id))?.status === "done");
    await new Promise((r) => setTimeout(r, 600)); // a duplicate run would finish (and fail) by now
    stops.forEach((stop) => stop());
    expect((await getMeeting(info.id))?.status).toBe("done");
    expect((await listMeetings()).map((m) => m.id)).toEqual([info.id]);
    expect(await notes.listNotes()).toHaveLength(1);
  });
});
