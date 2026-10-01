import { ctx, emitChange } from "./context";
import { createNote, folderPathForId, getNoteMeta, moveNote, readNote, renameNote, trashNote, writeNoteBody } from "./notes";
import type { NoteMeta } from "./types";
import { learnVoices } from "./voices";
import { RECOGNIZE } from "@/lib/voices";
import { MEETINGS_DIR, isMeetingsPath } from "@/lib/paths";
import { PROCESSING_PLACEHOLDER, composeMeetingBody, defaultMeetingTitle, fillMeetingNote, type SpeakerNames } from "@/lib/meetingNote";
import type { ProcessResult, RecordingInfo } from "@/platform/meetings";

export type MeetingStatus = "processing" | "done" | "failed";

export interface Meeting {
  id: string;
  noteId: string | null;
  startedAt: string;
  durationSec: number;
  status: MeetingStatus;
  error: string | null;
  /** The note, if it still exists (null when it was deleted). */
  note: NoteMeta | null;
  /** Folder the note is in; null = unassigned. */
  folderId: string | null;
  /** The transcript as data (null for recordings made before it was stored). */
  result: ProcessResult | null;
  /** Names the user gave the separated speakers. */
  speakers: SpeakerNames;
}

interface Row {
  id: string;
  note_id: string | null;
  started_at: string;
  duration_sec: number;
  status: MeetingStatus;
  error: string | null;
  result: string | null;
  speakers: string | null;
}

function parse<T>(json: string | null, fallback: T): T {
  try {
    return json ? (JSON.parse(json) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Every recording, newest first. Recordings whose note was deleted are left out. */
export async function listMeetings(): Promise<Meeting[]> {
  const rows = await ctx().sql.select<Row>(`SELECT * FROM meetings ORDER BY started_at DESC`);
  const out: Meeting[] = [];
  for (const r of rows) {
    const note = r.note_id ? await getNoteMeta(r.note_id) : null;
    if (!note) continue;
    out.push({
      id: r.id,
      noteId: r.note_id,
      startedAt: r.started_at,
      durationSec: r.duration_sec,
      status: r.status,
      error: r.error,
      note,
      folderId: isMeetingsPath(note.path) ? null : note.folderId,
      result: parse<ProcessResult | null>(r.result, null),
      speakers: parse<SpeakerNames>(r.speakers, {}),
    });
  }
  return out;
}

export async function getMeeting(id: string): Promise<Meeting | null> {
  return (await listMeetings()).find((m) => m.id === id) ?? null;
}

/** A stopped recording becomes an unassigned note right away; the text follows when processing is done. */
export async function createMeeting(info: RecordingInfo): Promise<Meeting> {
  const existing = await getMeeting(info.id);
  if (existing) return existing;
  const note = await createNote(MEETINGS_DIR, defaultMeetingTitle(info.startedAt), PROCESSING_PLACEHOLDER);
  // A row can outlive its note (deleted by hand); it then gets the new note.
  await ctx().sql.execute(
    `INSERT INTO meetings (id, note_id, started_at, duration_sec, status, error) VALUES (?, ?, ?, ?, 'processing', NULL)
     ON CONFLICT(id) DO UPDATE SET note_id = excluded.note_id, status = 'processing', error = NULL`,
    [info.id, note.id, new Date(info.startedAt).toISOString(), info.durationSec ?? 0],
  );
  emitChange("meetings", "notes");
  return (await getMeeting(info.id))!;
}

/** Name the recording's note and move it into a folder (null = unassigned). */
export async function nameAndAssign(meetingId: string, title: string, folderId: string | null): Promise<void> {
  const m = await getMeeting(meetingId);
  if (!m?.noteId) return;
  if (title.trim() && title.trim() !== m.note?.title) await renameNote(m.noteId, title.trim());
  await assignFolder(meetingId, folderId);
}

/** Move the recording's note into a folder, or back to the unassigned recordings. */
export async function assignFolder(meetingId: string, folderId: string | null): Promise<void> {
  const m = await getMeeting(meetingId);
  if (!m?.noteId) return;
  const target = folderId ? await folderPathForId(folderId) : MEETINGS_DIR;
  await moveNote(m.noteId, target);
  emitChange("meetings");
}

export async function setStatus(id: string, status: MeetingStatus, error: string | null = null): Promise<void> {
  await ctx().sql.execute(`UPDATE meetings SET status = ?, error = ? WHERE id = ?`, [status, error, id]);
  emitChange("meetings");
}

/** Write the transcript and summary into the recording's note. */
export async function completeMeeting(id: string, result: ProcessResult): Promise<void> {
  const rows = await ctx().sql.select<Row>(`SELECT * FROM meetings WHERE id = ?`, [id]);
  const row = rows[0];
  if (!row?.note_id) return;
  // Speakers that sound like someone named before get that name (a new transcription
  // numbers the voices anew, so earlier names for this meeting are replaced too).
  const names: SpeakerNames = Object.fromEntries(
    Object.entries(result.recognized ?? {})
      .filter(([, m]) => m.similarity >= RECOGNIZE)
      .map(([sid, m]) => [Number(sid), m.name]),
  );
  await ctx().sql.execute(`UPDATE meetings SET result = ?, speakers = ? WHERE id = ?`, [JSON.stringify(result), JSON.stringify(names), id]);
  await writeMeetingNote(row, result, names);
  await setStatus(id, "done");
}

async function writeMeetingNote(row: Row, result: ProcessResult, names: SpeakerNames) {
  const note = row.note_id ? await readNote(row.note_id) : null;
  if (!note || !row.note_id) return;
  const body = composeMeetingBody(result, Date.parse(row.started_at), row.duration_sec, names);
  await writeNoteBody(row.note_id, fillMeetingNote(note.body, body));
}

/**
 * Give the separated speakers names ("Spreker 2" → "Jeroen"; the same name for
 * two numbers merges them) and rebuild the note. `summary`: a new summary made
 * with those names, if there is one.
 */
export async function nameSpeakers(id: string, names: SpeakerNames, summary?: string): Promise<void> {
  const rows = await ctx().sql.select<Row>(`SELECT * FROM meetings WHERE id = ?`, [id]);
  const row = rows[0];
  const result = row && parse<ProcessResult | null>(row.result, null);
  if (!row || !result) return;
  const clean = Object.fromEntries(Object.entries(names).filter(([, n]) => n.trim()).map(([k, n]) => [k, n.trim()]));
  const updated: ProcessResult = summary ? { ...result, summary, summaryError: null } : result;
  await ctx().sql.execute(`UPDATE meetings SET result = ?, speakers = ? WHERE id = ?`, [JSON.stringify(updated), JSON.stringify(clean), id]);
  await writeMeetingNote(row, updated, clean);
  // Remember these voices for next time.
  await learnVoices(id, clean, result.voices);
  emitChange("meetings");
}

/** Names used for speakers in earlier meetings, most recent first (suggestions). */
export async function knownSpeakerNames(): Promise<string[]> {
  const rows = await ctx().sql.select<{ speakers: string }>(`SELECT speakers FROM meetings WHERE speakers IS NOT NULL ORDER BY started_at DESC`);
  return [...new Set(rows.flatMap((r) => Object.values(parse<SpeakerNames>(r.speakers, {}))))];
}

/** Speaker separation found voices to name. */
export function hasSpeakers(m: Meeting): boolean {
  return m.status === "done" && !!m.result?.segments.some((s) => s.speakerId);
}

export async function getMeetingByNote(noteId: string): Promise<Meeting | null> {
  return (await listMeetings()).find((m) => m.noteId === noteId) ?? null;
}

/** Remove a recording: its note goes to the trash (restorable). */
export async function deleteMeeting(id: string): Promise<void> {
  const m = await getMeeting(id);
  if (m?.noteId) await trashNote(m.noteId);
  await ctx().sql.execute(`DELETE FROM meetings WHERE id = ?`, [id]);
  emitChange("meetings");
}
