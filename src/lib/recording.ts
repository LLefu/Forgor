import type { Levels } from "@/platform/meetings";

/** No sound for this long: "Still recording?" (the native side also sends a notification). */
export const SILENCE_WARNING_SEC = 600;
/** A mic that gave only exact zeros for this long has no permission or is muted. */
const NO_SIGNAL_AFTER_SEC = 4;

export interface RecordingWarning {
  kind: "error" | "warning";
  text: string;
}

/** What is wrong with the recording right now, if anything. */
export function recordingWarnings(l: Levels): RecordingWarning[] {
  const out: RecordingWarning[] = [];
  if (!l.micSignal && l.elapsedSec >= NO_SIGNAL_AFTER_SEC) {
    out.push({
      kind: "error",
      text: "No sound from your microphone. Check that it isn't muted and that Forgor may use it (System Settings → Privacy & Security → Microphone).",
    });
  }
  if (!l.systemAudio) out.push({ kind: "warning", text: "Only your microphone is being recorded: the computer's sound (the others in a call) isn't available." });
  if (l.silentSec >= SILENCE_WARNING_SEC) {
    out.push({ kind: "warning", text: `Nothing heard for ${Math.floor(l.silentSec / 60)} minutes. Still recording? Stop it if the meeting is over.` });
  }
  return out;
}

/** Meter width for a loudness: -60..0 dB → 0..100 %. */
export function meterWidth(rms: number): number {
  const db = 20 * Math.log10(rms + 1e-6);
  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
}
