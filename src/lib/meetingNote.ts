import { format } from "date-fns";
import { nl as nlLocale } from "date-fns/locale";
import type { ProcessResult, Segment } from "@/platform/meetings";

/** The name a recording gets until the user picks one: "Meeting 30 Sep 14:05". */
export function defaultMeetingTitle(startedAt: number): string {
  return `Meeting ${format(startedAt, "d MMM HH.mm")}`;
}

/** Body of a meeting note while it is being transcribed. */
export const PROCESSING_PLACEHOLDER = "_Transcribing… This note fills in by itself when it's done._";

const LABELS = {
  nl: { me: "Ik", others: "Anderen", speaker: "Spreker", transcript: "Transcript", recorded: "Opgenomen op", at: "om", noSpeech: "Er is geen spraak gevonden in deze opname.", noSummary: "Geen samenvatting" },
  en: { me: "Me", others: "Others", speaker: "Speaker", transcript: "Transcript", recorded: "Recorded on", at: "at", noSpeech: "No speech was found in this recording.", noSummary: "No summary" },
} as const;

/** Speaker id → the name the user gave that voice. */
export type SpeakerNames = Record<number, string>;

/** How a segment's speaker is shown: "Ik", a given name, "Spreker 2", "Anderen", or nothing (in person, unseparated). */
export function speakerLabel(s: Segment, language: "nl" | "en", names: SpeakerNames = {}): string {
  const l = LABELS[language];
  if (s.speaker === "me") return l.me;
  if (s.speakerId) return names[s.speakerId]?.trim() || `${l.speaker} ${s.speakerId}`;
  return s.speaker === "others" ? l.others : "";
}

/** The separated voices with how much each said and a few longer quotes, to recognize who is who. */
export function speakersOf(segments: Segment[]): { id: number; seconds: number; quotes: string[] }[] {
  const by = new Map<number, { id: number; seconds: number; quotes: Segment[] }>();
  for (const s of segments) {
    if (!s.speakerId || s.speaker === "me") continue;
    const e = by.get(s.speakerId) ?? { id: s.speakerId, seconds: 0, quotes: [] };
    e.seconds += s.end - s.start;
    e.quotes.push(s);
    by.set(s.speakerId, e);
  }
  return [...by.values()]
    .sort((a, b) => a.id - b.id)
    .map((e) => ({ id: e.id, seconds: e.seconds, quotes: [...e.quotes].sort((a, b) => b.text.length - a.text.length).slice(0, 2).map((q) => q.text) }));
}

export function formatTimestamp(sec: number): string {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.max(0, Math.round(sec))} s`;
  const min = Math.round(sec / 60);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
}

/**
 * Consecutive segments of the same speaker become one paragraph (VAD cuts
 * speech at pauses), unless the pause is long or the paragraph gets long.
 */
export function groupSegments(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    const last = out[out.length - 1];
    if (last && last.speaker === s.speaker && (last.speakerId ?? null) === (s.speakerId ?? null) && s.start - last.end < 3 && last.text.length + s.text.length < 600) {
      out[out.length - 1] = { ...last, end: s.end, text: `${last.text} ${s.text}` };
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

/** Markdown of a processed meeting: date line, summary, then the transcript. */
export function composeMeetingBody(result: ProcessResult, startedAt: number, durationSec: number, names: SpeakerNames = {}): string {
  const l = LABELS[result.language];
  const date =
    result.language === "nl"
      ? `${format(startedAt, "d MMMM yyyy", { locale: nlLocale })} ${l.at} ${format(startedAt, "HH:mm")}`
      : `${format(startedAt, "d MMMM yyyy")} ${l.at} ${format(startedAt, "HH:mm")}`;
  const parts = [`_${l.recorded} ${date} · ${formatDuration(durationSec)}_`];
  if (!result.segments.length) {
    parts.push(`_${l.noSpeech}_`);
    return parts.join("\n\n") + "\n";
  }
  if (result.summary?.trim()) parts.push(result.summary.trim());
  else if (result.summaryError) parts.push(`_${l.noSummary}: ${result.summaryError}._`);
  parts.push(`## ${l.transcript}`);
  // Speakers given the same name are one person (a voice split in two): merge their paragraphs too.
  const named = result.segments.map((s) => ({ ...s, speakerId: s.speakerId && names[s.speakerId] ? firstIdWithName(names, names[s.speakerId]) : s.speakerId }));
  for (const s of groupSegments(named)) {
    const who = speakerLabel(s, result.language, names);
    parts.push(`**[${formatTimestamp(s.start)}]${who ? ` ${escapeLine(who)}` : ""}:** ${escapeLine(s.text)}`);
  }
  return parts.join("\n\n") + "\n";
}

function firstIdWithName(names: SpeakerNames, name: string): number {
  return Math.min(...Object.entries(names).filter(([, n]) => n.trim().toLowerCase() === name.trim().toLowerCase()).map(([id]) => Number(id)));
}

/** Speech never contains markdown; keep characters that would turn a line into a heading/list literal. */
function escapeLine(text: string): string {
  return text.replace(/([\\*_`[\]<>])/g, "\\$1");
}

/** Where a generated part starts: its date line (the editor may turn `_…_` into `*…*`). */
const GENERATED_START = /^[_*](Opgenomen op|Recorded on) /m;

/**
 * Put the generated text into the note. Text the user typed above it (while it
 * was being transcribed) is kept; an earlier generated part is replaced
 * ("Transcribe again").
 */
export function fillMeetingNote(current: string, generated: string): string {
  const start = current.search(GENERATED_START);
  const own = (start >= 0 ? current.slice(0, start) : current).replace(PROCESSING_PLACEHOLDER, "").trim();
  return own ? `${own}\n\n${generated}` : generated;
}

/** Fallback without the summary model: put the names in place of "Spreker 2" in an existing summary. */
export function renameInSummary(summary: string, names: SpeakerNames): string {
  return summary.replace(/\b(Spreker|Speaker) (\d+)\b/g, (all, _w, id: string) => names[Number(id)]?.trim() || all);
}
