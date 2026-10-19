import { create } from "zustand";
import { useQuery } from "@tanstack/react-query";
import { useUI } from "@/app/store";
import { isPluginEnabled, usePluginEnabled } from "../host";
import * as data from "@/data/meetings";
import { knownVoices } from "@/data/voices";
import { renameInSummary, type SpeakerNames } from "@/lib/meetingNote";
import { showError } from "@/components/Toasts";
import { isTauri } from "@/platform/env";
import { meetings, type ProcessProgress, type RecordingInfo } from "@/platform/meetings";
import { modelReady, refreshModels, useModelReady, useModelsStore } from "@/app/models";

/**
 * Meeting recordings at runtime (main window): recording state, processing
 * progress and the "name this recording" dialog. Processing runs one
 * recording at a time. The models are shared (app/models.ts).
 */
interface MeetingsState {
  current: RecordingInfo | null;
  /** The recording whose speakers are being named (the dialog). */
  speakersOf: string | null;
  setSpeakersOf: (id: string | null) => void;
  progress: Record<string, ProcessProgress>;
  /** The recording that was just stopped: asks for a name and folder. */
  naming: string | null;
  closeNaming: () => void;
}

export const useMeetingsStore = create<MeetingsState>((set) => ({
  current: null,
  speakersOf: null,
  setSpeakersOf: (id) => set({ speakersOf: id }),
  progress: {},
  naming: null,
  closeNaming: () => set({ naming: null }),
}));

export const useMeetings = () => useQuery({ queryKey: ["meetings"], queryFn: data.listMeetings });

/** Plugin on and the speech model is there: recording can start. */
export function useRecordingAvailable(): boolean {
  const enabled = usePluginEnabled("meetings");
  const speech = useModelReady("speech");
  return enabled && speech;
}

/** Tell the native side (tray menu, mic) about the current settings. */
export async function configureNative() {
  const { settings } = useUI.getState();
  await meetings().configure(isPluginEnabled(settings, "meetings") && modelReady("speech"), settings.meetingMic);
}

export async function startRecording() {
  const info = await meetings().start();
  useMeetingsStore.setState({ current: info });
}

export async function stopRecording() {
  await meetings().stop(); // the "stopped" event does the rest
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
 * with the names (only the summary step, ~25 s) when the language model is there.
 */
export async function applySpeakerNames(meeting: data.Meeting, names: SpeakerNames): Promise<void> {
  const result = meeting.result;
  if (!result) return;
  let summary: string | undefined;
  if (modelReady("language") && result.segments.length) {
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
 * Main window, while the plugin is enabled: listen to the native side and pick
 * up recordings that weren't processed yet (the app quit or crashed). Returns
 * how to stop; stopping also takes "Start recording" out of the tray.
 */
export function startMeetings(): () => void {
  const api = meetings();
  const offs: Promise<() => void>[] = [
    api.onRecording(({ current, stopped }) => {
      useMeetingsStore.setState({ current });
      if (stopped) onStopped(stopped).catch((e) => showError(e, "Could not save the recording"));
    }),
    api.onProgress((p) => useMeetingsStore.setState((s) => ({ progress: { ...s.progress, [p.id]: p } }))),
    api.onError((message) => showError(message, "Recording")),
  ];
  // The tray offers "Start recording" only while the speech model is there.
  let hadSpeech = modelReady("speech");
  const offModels = useModelsStore.subscribe(() => {
    if (modelReady("speech") === hadSpeech) return;
    hadSpeech = !hadSpeech;
    configureNative().catch((e) => showError(e, "Meeting recordings"));
  });
  void (async () => {
    await refreshModels();
    useMeetingsStore.setState({ current: await api.current() });
    await configureNative();
    // Once per window: React StrictMode runs this effect twice in dev.
    if (!isPluginEnabled(useUI.getState().settings, "meetings") || recovered) return;
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
  return () => {
    offModels();
    offs.forEach((o) => void o.then((off) => off()));
    configureNative().catch((e) => showError(e, "Meeting recordings"));
  };
}
