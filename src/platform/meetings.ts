import { isTauri } from "./env";

/**
 * Meeting recordings: audio capture, the local models and processing live in
 * Rust (src-tauri/src/meetings). The browser build (dev, demo, e2e) gets a
 * fake with the same behaviour, so the whole flow can be tested there.
 */

export interface RecordingInfo {
  id: string;
  /** Unix time in ms. */
  startedAt: number;
  /** Set once stopped. */
  durationSec: number | null;
  /** False when only the microphone could be recorded. */
  systemAudio: boolean;
}

export type ModelId = "speech" | "speakers" | "summary";

export interface ModelStatus {
  id: ModelId;
  sizeBytes: number;
  downloaded: boolean;
  downloading: boolean;
  path: string;
}

export interface DownloadProgress {
  id: ModelId;
  received: number;
  total: number;
  done: boolean;
  error: string | null;
}

export interface Segment {
  /** Seconds from the start of the recording. */
  start: number;
  end: number;
  speaker: "me" | "others" | "unknown";
  /** Which of the others (1, 2, 3… in order of appearance); null without speaker separation. */
  speakerId?: number | null;
  text: string;
}

export interface ProcessResult {
  language: "nl" | "en";
  segments: Segment[];
  /** Voice fingerprint per separated speaker (unit length). */
  voices?: Record<number, number[]>;
  /** Speakers that sound like someone named before (see lib/voices.ts for the thresholds). */
  recognized?: Record<number, { name: string; similarity: number }>;
  summary: string | null;
  /** Why there is no summary (the transcript is still there). */
  summaryError: string | null;
}

export interface ProcessProgress {
  id: string;
  stage: "transcribing" | "summarizing";
  progress: number;
}

export type MeetingLanguage = "auto" | "nl" | "en";

/** Live levels while recording. */
export interface Levels {
  /** Current loudness 0..1 (RMS). */
  mic: number;
  system: number;
  /** The mic delivers anything but exact zeros (without permission macOS gives zeros). */
  micSignal: boolean;
  systemAudio: boolean;
  elapsedSec: number;
  /** How long neither track had sound. */
  silentSec: number;
}

/** A voice the user named before: their average fingerprint. */
export interface KnownVoice {
  name: string;
  print: number[];
}

export interface MeetingsBackend {
  models(): Promise<ModelStatus[]>;
  download(id: ModelId): Promise<void>;
  cancelDownload(id: ModelId): Promise<void>;
  deleteModel(id: ModelId): Promise<void>;
  inputDevices(): Promise<{ devices: string[]; default: string | null }>;
  /** Whether the tray offers "Start recording", and which mic to record. */
  configure(available: boolean, mic: string | null): Promise<void>;
  start(): Promise<RecordingInfo>;
  /** Stops the recording and brings the main window up. */
  stop(): Promise<RecordingInfo | null>;
  current(): Promise<RecordingInfo | null>;
  /** Live levels (null when not recording). */
  levels(): Promise<Levels | null>;
  /** Browser fake only: pretend the levels are like this (e2e). */
  simulate?(levels: Partial<Levels>): void;
  /** Recordings on disk that aren't running: waiting to be processed or cut off by a crash. */
  recordings(): Promise<RecordingInfo[]>;
  discard(id: string): Promise<void>;
  /** `voices`: people named in earlier meetings, to recognize them. */
  process(id: string, language: MeetingLanguage, voices: KnownVoice[]): Promise<ProcessResult>;
  /** Only the summary step again, e.g. after naming the speakers (`names`: speaker id → name). */
  summarize(segments: Segment[], language: "nl" | "en", names: Record<number, string>): Promise<string>;
  onRecording(cb: (e: { current: RecordingInfo | null; stopped: RecordingInfo | null }) => void): Promise<() => void>;
  onProgress(cb: (e: ProcessProgress) => void): Promise<() => void>;
  onDownload(cb: (e: DownloadProgress) => void): Promise<() => void>;
  /** Errors from the tray menu (e.g. no microphone). */
  onError(cb: (message: string) => void): Promise<() => void>;
}

let backend: MeetingsBackend | null = null;

export function meetings(): MeetingsBackend {
  backend ??= isTauri() ? tauriBackend() : memoryBackend();
  return backend;
}

// ---------------------------------------------------------------- desktop

function tauriBackend(): MeetingsBackend {
  const invoke = async <T>(cmd: string, args?: Record<string, unknown>) => (await import("@tauri-apps/api/core")).invoke<T>(cmd, args);
  const listen = async <T>(event: string, cb: (payload: T) => void) => (await import("@tauri-apps/api/event")).listen<T>(event, (e) => cb(e.payload));
  return {
    models: () => invoke("meetings_models"),
    download: (id) => invoke("meetings_download", { id }),
    cancelDownload: (id) => invoke("meetings_cancel_download", { id }),
    deleteModel: (id) => invoke("meetings_delete_model", { id }),
    inputDevices: () => invoke("meetings_input_devices"),
    configure: (available, mic) => invoke("meetings_configure", { available, mic }),
    start: () => invoke("meetings_start"),
    stop: () => invoke("meetings_stop"),
    current: () => invoke("meetings_state"),
    levels: () => invoke("meetings_levels"),
    recordings: () => invoke("meetings_recordings"),
    discard: (id) => invoke("meetings_discard", { id }),
    process: (id, language, voices) => invoke("meetings_process", { id, language, voices }),
    summarize: (segments, language, names) => invoke("meetings_summarize", { segments, language, names }),
    onRecording: (cb) => listen("wn://recording", cb),
    onProgress: (cb) => listen("wn://meeting-progress", cb),
    onDownload: (cb) => listen("wn://model-download", cb),
    onError: (cb) => listen("wn://meetings-error", cb),
  };
}

// ---------------------------------------------------------------- browser fake

const FAKE_SIZES: Record<ModelId, number> = { speech: 671_122_626, speakers: 34_274_077, summary: 4_590_807_392 };

/** Browser build only: behaves like the desktop backend, with a canned transcript. */
export function memoryBackend(): MeetingsBackend {
  const downloaded = new Set<ModelId>();
  const downloading = new Set<ModelId>();
  const stored = new Map<string, RecordingInfo>();
  let current: RecordingInfo | null = null;
  let simulated: Partial<Levels> = {};
  const listeners = { recording: new Set<(e: { current: RecordingInfo | null; stopped: RecordingInfo | null }) => void>(), progress: new Set<(e: ProcessProgress) => void>(), download: new Set<(e: DownloadProgress) => void>() };
  const sub = <T>(set: Set<T>, cb: T) => {
    set.add(cb);
    return Promise.resolve(() => void set.delete(cb));
  };
  const tick = () => new Promise((r) => setTimeout(r, 30));

  return {
    models: async () =>
      (["speech", "speakers", "summary"] as ModelId[]).map((id) => ({ id, sizeBytes: FAKE_SIZES[id], downloaded: downloaded.has(id), downloading: downloading.has(id), path: `memory://models/${id}` })),
    download: async (id) => {
      downloading.add(id);
      const total = FAKE_SIZES[id];
      for (let i = 1; i <= 5; i++) {
        await tick();
        listeners.download.forEach((l) => l({ id, received: (total * i) / 5, total, done: i === 5, error: null }));
      }
      downloading.delete(id);
      downloaded.add(id);
    },
    cancelDownload: async () => {},
    deleteModel: async (id) => void downloaded.delete(id),
    inputDevices: async () => ({ devices: ["Built-in Microphone", "USB Headset"], default: "Built-in Microphone" }),
    configure: async () => {},
    start: async () => {
      current ??= { id: String(Date.now()), startedAt: Date.now(), durationSec: null, systemAudio: true };
      stored.set(current.id, current);
      listeners.recording.forEach((l) => l({ current, stopped: null }));
      return current;
    },
    stop: async () => {
      if (!current) return null;
      const stopped = { ...current, durationSec: Math.max(1, Math.round((Date.now() - current.startedAt) / 1000)) };
      stored.set(stopped.id, stopped);
      current = null;
      listeners.recording.forEach((l) => l({ current: null, stopped }));
      return stopped;
    },
    current: async () => current,
    levels: async () => {
      if (!current) return null;
      const elapsedSec = (Date.now() - current.startedAt) / 1000;
      const wave = (f: number) => 0.02 + 0.05 * Math.abs(Math.sin(elapsedSec * f));
      return { mic: wave(3), system: wave(2), micSignal: true, systemAudio: true, elapsedSec, silentSec: 0, ...simulated };
    },
    simulate: (l) => void (simulated = { ...simulated, ...l }),
    recordings: async () => [...stored.values()].filter((r) => r.id !== current?.id),
    discard: async (id) => void stored.delete(id),
    process: async (id, _language, known) => {
      if (!stored.has(id)) throw new Error("The audio of this recording is gone");
      const separated = downloaded.has("speakers");
      // Two fixed "voices"; the same fake person sounds the same in every recording.
      const voices: Record<number, number[]> = separated ? { 1: [1, 0, 0], 2: [0, 1, 0] } : {};
      const recognized = Object.fromEntries(
        Object.entries(voices).flatMap(([sid, print]) => {
          const best = known.map((k) => ({ name: k.name, similarity: k.print.reduce((n, x, i) => n + x * (print[i] ?? 0), 0) })).sort((a, b) => b.similarity - a.similarity)[0];
          return best && best.similarity >= 0.5 ? [[sid, best]] : [];
        }),
      );
      if (!downloaded.has("speech")) throw new Error("Download the speech model first (Settings → Meeting recordings)");
      for (const stage of ["transcribing", "summarizing"] as const) {
        for (let i = 0; i <= 4; i++) {
          await tick();
          listeners.progress.forEach((l) => l({ id, stage, progress: i / 4 }));
        }
      }
      return {
        language: "nl",
        segments: [
          { start: 0, end: 4, speaker: "others", speakerId: separated ? 1 : null, text: "Goedemorgen allemaal. Zullen we beginnen met de planning?" },
          { start: 5, end: 9, speaker: "me", text: "Ja, ik rond de begroting voor vrijdag af." },
          { start: 10, end: 13, speaker: "others", speakerId: separated ? 2 : null, text: "Top. Dan bel ik de klant over de oplevering." },
        ],
        voices,
        recognized,
        summary: downloaded.has("summary") ? fakeSummary(recognized[2]?.name ?? (separated ? "Spreker 2" : "Anderen")) : null,
        summaryError: downloaded.has("summary") ? null : "The summary model isn't downloaded",
      };
    },
    summarize: async (_segments, _language, names) => {
      if (!downloaded.has("summary")) throw new Error("The summary model isn't downloaded");
      await tick();
      return fakeSummary(names[2] ?? "Spreker 2");
    },
    onRecording: (cb) => sub(listeners.recording, cb),
    onProgress: (cb) => sub(listeners.progress, cb),
    onDownload: (cb) => sub(listeners.download, cb),
    onError: () => Promise.resolve(() => {}),
  };
}

function fakeSummary(caller: string) {
  return `## Samenvatting\nDemo-transcript (browserversie): de planning is besproken.\n\n## Belangrijkste punten\n- De begroting is vrijdag klaar.\n\n## Besluiten\n- De oplevering wordt met de klant besproken.\n\n## Actiepunten\n- Ik: begroting afronden (vrijdag)\n- ${caller}: klant bellen over de oplevering`;
}
