import { create } from "zustand";
import { useUI } from "./store";
import * as data from "@/data/meetings";
import { knownVoices } from "@/data/voices";
import { renameInSummary, type SpeakerNames } from "@/lib/meetingNote";
import { showError } from "@/components/Toasts";
import { isTauri } from "@/platform/env";
import { meetings, type DownloadProgress, type ModelId, type ModelStatus, type ProcessProgress, type RecordingInfo } from "@/platform/meetings";

/**
 * Meeting recordings at runtime (main window): recording state, model
 * downloads, processing progress and the "name this recording" dialog.
 * Processing runs one recording at a time.
 */
interface MeetingsState {
  current: RecordingInfo | null;
  /** The recording whose speakers are being named (the dialog). */
  speakersOf: string | null;
  setSpeakersOf: (id: string | null) => void;
  /** Models waiting for their turn in "Download models". */
  queued: ModelId[];
  models: ModelStatus[];
  downloads: Partial<Record<ModelId, DownloadProgress>>;
  progress: Record<string, ProcessProgress>;
  /** The recording that was just stopped: asks for a name and folder. */
  naming: string | null;
  closeNaming: () => void;
}

export const useMeetingsStore = create<MeetingsState>((set) => ({
  current: null,
  speakersOf: null,
  setSpeakersOf: (id) => set({ speakersOf: id }),
  queued: [],
  models: [],
  downloads: {},
  progress: {},
  naming: null,
  closeNaming: () => set({ naming: null }),
}));

/** Feature on and the speech model is there: recording can start. */
export function useRecordingAvailable(): boolean {
  const enabled = useUI((s) => s.settings.meetingsEnabled);
  const speech = useMeetingsStore((s) => s.models.find((m) => m.id === "speech")?.downloaded ?? false);
  return enabled && speech;
}

export async function refreshModels() {
  useMeetingsStore.setState({ models: await meetings().models() });
}

/** Tell the native side (tray menu, mic) about the current settings. */
export async function configureNative() {
  const { settings } = useUI.getState();
  const speech = useMeetingsStore.getState().models.find((m) => m.id === "speech")?.downloaded ?? false;
  await meetings().configure(settings.meetingsEnabled && speech, settings.meetingMic);
}

export async function startRecording() {
  const info = await meetings().start();
  useMeetingsStore.setState({ current: info });
}

export async function stopRecording() {
  await meetings().stop(); // the "stopped" event does the rest
}

/** Download every model that is missing, one after the other. */
export async function downloadModels(ids?: ModelId[]) {
  const missing = useMeetingsStore.getState().models.filter((m) => !m.downloaded && (!ids || ids.includes(m.id)));
  useMeetingsStore.setState((s) => ({ queued: [...new Set([...s.queued, ...missing.map((m) => m.id)])] }));
  try {
    for (const m of missing) {
      useMeetingsStore.setState((s) => ({ queued: s.queued.filter((q) => q !== m.id) }));
      await meetings().download(m.id);
      await refreshModels();
    }
  } catch (e) {
    if (!/cancelled/i.test(String((e as Error)?.message ?? e))) throw e;
  } finally {
    useMeetingsStore.setState((s) => ({ queued: s.queued.filter((q) => !missing.some((m) => m.id === q)) }));
    await refreshModels();
    await configureNative();
  }
}

export async function deleteModel(id: ModelId) {
  await meetings().deleteModel(id);
  useMeetingsStore.setState((s) => ({ downloads: { ...s.downloads, [id]: undefined } }));
  await refreshModels();
  await configureNative();
}

// ---------------------------------------------------------------- processing

const KEEP_AUDIO = import.meta.env.DEV && isTauri();

let queue: Promise<void> = Promise.resolve();
/** Queued or running; asking again for the same recording is a no-op. */
const inFlight = new Set<string>();

/** Transcribe + summarize a recording (queued), then write its note and delete the audio. */
export function processMeeting(id: string): Promise<void> {
  if (inFlight.has(id)) return queue;
  inFlight.add(id);
  const run = async () => {
    await data.setStatus(id, "processing");
    try {
      const result = await meetings().process(id, useUI.getState().settings.meetingLanguage, await knownVoices());
      await data.completeMeeting(id, result);
      // The note is saved: the audio is no longer needed. The dev app keeps it
      // (<app data>/recordings/<id>/), so real meetings can be re-run while tuning.
      if (!KEEP_AUDIO) await meetings().discard(id);
    } catch (e) {
      // The audio stays, so "Try again" can process it later.
      await data.setStatus(id, "failed", String((e as Error)?.message ?? e));
      showError(e, "Could not transcribe the recording");
    } finally {
      inFlight.delete(id);
      useMeetingsStore.setState((s) => {
        const { [id]: _, ...rest } = s.progress;
        return { progress: rest };
      });
    }
  };
  queue = queue.then(run, run);
  return queue;
}

let recovered = false;

/**
 * Name the separated speakers and rebuild the note. The summary is made again
 * with the names (only the summary step, ~25 s) when the summary model is there.
 */
export async function applySpeakerNames(meeting: data.Meeting, names: SpeakerNames): Promise<void> {
  const result = meeting.result;
  if (!result) return;
  const hasSummaryModel = useMeetingsStore.getState().models.some((m) => m.id === "summary" && m.downloaded);
  let summary: string | undefined;
  if (hasSummaryModel && result.segments.length) {
    try {
      summary = await meetings().summarize(result.segments, result.language, names);
    } catch (e) {
      showError(e, "Could not update the summary; the names were put in the existing one");
    }
  }
  summary ??= result.summary ? renameInSummary(result.summary, names) : undefined;
  await data.nameSpeakers(meeting.id, names, summary);
}

async function onStopped(info: RecordingInfo) {
  await data.createMeeting(info);
  useMeetingsStore.setState({ naming: info.id });
  void processMeeting(info.id);
}

/**
 * Main window: listen to the native side and pick up recordings that weren't
 * processed yet (the app quit or crashed). Returns an unsubscribe function.
 */
export function startMeetings(): () => void {
  const api = meetings();
  const offs: Promise<() => void>[] = [
    api.onRecording(({ current, stopped }) => {
      useMeetingsStore.setState({ current });
      if (stopped) onStopped(stopped).catch((e) => showError(e, "Could not save the recording"));
    }),
    api.onProgress((p) => useMeetingsStore.setState((s) => ({ progress: { ...s.progress, [p.id]: p } }))),
    api.onDownload((p) => useMeetingsStore.setState((s) => ({ downloads: { ...s.downloads, [p.id]: p } }))),
    api.onError((message) => showError(message, "Recording")),
  ];
  void (async () => {
    await refreshModels();
    useMeetingsStore.setState({ current: await api.current() });
    await configureNative();
    // Once per window: React StrictMode runs this effect twice in dev.
    if (!useUI.getState().settings.meetingsEnabled || recovered) return;
    recovered = true;
    for (const info of await api.recordings()) {
      const known = await data.getMeeting(info.id);
      if (!known) {
        await data.createMeeting(info); // cut off by a crash or quit before it was handled
        void processMeeting(info.id);
      } else if (known.status === "processing") {
        void processMeeting(info.id);
      }
    }
  })().catch((e) => showError(e, "Meeting recordings"));
  return () => offs.forEach((o) => void o.then((off) => off()));
}
