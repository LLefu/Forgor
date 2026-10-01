import { ctx, emitChange } from "./context";
import type { KnownVoice } from "@/platform/meetings";
import type { SpeakerNames } from "@/lib/meetingNote";
import { nowIso } from "@/lib/utils";

/**
 * Voice fingerprints of speakers the user named, to recognize them in later
 * meetings. One sample per meeting and speaker; a person's voice is the
 * average of their samples. Stored only in the local database (biometric
 * data: never in the notes, deletable per person in Settings).
 */

export interface VoiceSummary {
  name: string;
  meetings: number;
  updatedAt: string;
}

interface SampleRow {
  meeting_id: string;
  speaker_id: number;
  name: string;
  print: string;
  created_at: string;
}

const unit = (v: number[]) => {
  const n = Math.hypot(...v);
  return n ? v.map((x) => x / n) : v;
};

/** Every known person with their average fingerprint. */
export async function knownVoices(): Promise<KnownVoice[]> {
  const rows = await ctx().sql.select<SampleRow>(`SELECT * FROM voice_samples`);
  const by = new Map<string, number[][]>();
  for (const r of rows) {
    try {
      const print = JSON.parse(r.print) as number[];
      by.set(r.name, [...(by.get(r.name) ?? []), print]);
    } catch {
      // a broken sample is skipped
    }
  }
  return [...by].map(([name, prints]) => ({ name, print: unit(prints[0].map((_, i) => prints.reduce((n, p) => n + (p[i] ?? 0), 0))) }));
}

export async function listVoices(): Promise<VoiceSummary[]> {
  return (
    await ctx().sql.select<{ name: string; meetings: number; updated: string }>(
      `SELECT name, COUNT(DISTINCT meeting_id) AS meetings, MAX(created_at) AS updated FROM voice_samples GROUP BY name ORDER BY name COLLATE NOCASE`,
    )
  ).map((r) => ({ name: r.name, meetings: r.meetings, updatedAt: r.updated }));
}

/** Learn the voices named in a meeting (replacing what that meeting taught before, so a correction replaces a mistake). */
export async function learnVoices(meetingId: string, names: SpeakerNames, prints: Record<number, number[]> | undefined): Promise<void> {
  const { sql } = ctx();
  await sql.execute(`DELETE FROM voice_samples WHERE meeting_id = ?`, [meetingId]);
  for (const [id, name] of Object.entries(names)) {
    const print = prints?.[Number(id)];
    if (!name.trim() || !print?.length) continue;
    await sql.execute(`INSERT OR REPLACE INTO voice_samples (meeting_id, speaker_id, name, print, created_at) VALUES (?, ?, ?, ?, ?)`, [
      meetingId,
      Number(id),
      name.trim(),
      JSON.stringify(print),
      nowIso(),
    ]);
  }
  emitChange("meetings");
}

export async function forgetVoice(name: string): Promise<void> {
  await ctx().sql.execute(`DELETE FROM voice_samples WHERE name = ?`, [name]);
  emitChange("meetings");
}

export async function forgetMeetingVoices(meetingId: string): Promise<void> {
  await ctx().sql.execute(`DELETE FROM voice_samples WHERE meeting_id = ?`, [meetingId]);
}
