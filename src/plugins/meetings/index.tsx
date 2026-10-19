import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AudioLines, Mic, Square, Users } from "lucide-react";
import { useUI } from "@/app/store";
import { hidePopup } from "@/app/hotkey";
import { NavItem } from "@/components/NavItem";
import { Button } from "@/components/ui/button";
import { getMeetingByNote, hasSpeakers } from "@/data/meetings";
import { isMeetingsPath } from "@/lib/paths";
import { formatTimestamp } from "@/lib/meetingNote";
import { meetings, type RecordingInfo } from "@/platform/meetings";
import { isDownloaded } from "@/platform/models";
import type { NoteHeaderProps, Plugin } from "../types";
import { pluginView } from "../host";
import { startMeetings, useMeetingsStore } from "./state";
import { MeetingsPage } from "./MeetingsPage";
import { MeetingsSettings } from "./MeetingsSettings";
import { NameRecordingDialogHost } from "./NameRecordingDialog";
import { SpeakersDialogHost } from "./SpeakersDialog";
import { RecordingStatus } from "./RecordingStatus";
import { useElapsed } from "./RecordButton";

/** Record meetings (mic + computer sound), transcribe and summarize them on this computer. */
export const meetingsPlugin: Plugin = {
  id: "meetings",
  name: "Meeting recordings",
  description: "Record meetings and get a transcript and summary in a note, made on this computer: nothing is uploaded.",
  version: "1.0.0",
  author: "Forgor",
  icon: AudioLines,
  builtIn: true,
  models: [
    { id: "speech", for: "recording and the transcript" },
    { id: "speakers", optional: true, for: "telling the other participants apart" },
    { id: "language", optional: true, for: "the summary and action items" },
  ],
  settings: MeetingsSettings,
  sidebar: MeetingsNavItem,
  pages: { list: { useTab: () => ({ label: "Meetings", icon: AudioLines }), component: () => <MeetingsPage /> } },
  noteHeader: { breadcrumb: UnassignedBreadcrumb, actions: SpeakersButton },
  hosts: [NameRecordingDialogHost, SpeakersDialogHost],
  start: startMeetings,
  disableBlocked: () => (useMeetingsStore.getState().current ? "Stop the recording first." : null),
  useQuickMenu: useRecordingMenu,
};

/** "Meetings", with a red dot and the running time while recording. */
function MeetingsNavItem() {
  const startedAt = useMeetingsStore((s) => s.current?.startedAt ?? null);
  const elapsed = useElapsed(startedAt);
  return (
    <NavItem
      icon={AudioLines}
      label="Meetings"
      target={pluginView("meetings", "list")}
      testId="nav-meetings"
      badge={
        elapsed !== null && (
          <span className="flex items-center gap-1 text-xs tabular-nums text-destructive" data-testid="recording-indicator">
            <span className="size-2 animate-pulse rounded-full bg-destructive" /> {formatTimestamp(elapsed)}
          </span>
        )
      }
    />
  );
}

/** Recordings without a folder live in a hidden folder: say so where the folder path would be. */
function UnassignedBreadcrumb({ note }: NoteHeaderProps) {
  if (!isMeetingsPath(note.path)) return null;
  return (
    <button className="flex items-center gap-1 hover:text-foreground" onClick={() => useUI.getState().setView(pluginView("meetings", "list"))}>
      <AudioLines className="size-3.5" /> Meetings (unassigned)
    </button>
  );
}

function SpeakersButton({ note }: NoteHeaderProps) {
  const { data: meeting } = useQuery({ queryKey: ["meetingByNote", note.id], queryFn: () => getMeetingByNote(note.id) });
  if (!meeting || !hasSpeakers(meeting)) return null;
  return (
    <Button variant="ghost" size="sm" onClick={() => useMeetingsStore.getState().setSpeakersOf(meeting.id)} data-testid="note-speakers">
      <Users /> Speakers
    </Button>
  );
}

/** Quick menu: start or stop a recording (when the speech model is there). */
function useRecordingMenu(enabled: boolean) {
  const [state, setState] = useState<{ available: boolean; current: RecordingInfo | null }>({ available: false, current: null });
  useEffect(() => {
    if (!enabled) return setState({ available: false, current: null });
    let off = () => {};
    // The model can be downloaded in the main window while the popup stays loaded: check each time.
    const refresh = async () => {
      const [speech, current] = await Promise.all([isDownloaded("speech"), meetings().current()]);
      setState({ available: speech, current });
    };
    void refresh();
    void meetings()
      .onRecording(({ current }) => setState((s) => ({ ...s, current })))
      .then((o) => (off = o));
    window.addEventListener("focus", refresh);
    return () => {
      off();
      window.removeEventListener("focus", refresh);
    };
  }, [enabled]);

  const items = state.current
    ? [
        {
          icon: Square,
          label: "Stop recording",
          hint: "Opens Forgor to name the recording",
          action: async () => {
            await hidePopup();
            await meetings().stop(); // brings up the main window
          },
        },
      ]
    : state.available
      ? [
          {
            icon: Mic,
            label: "Start recording",
            hint: "Records your mic and the computer's sound",
            action: async () => {
              await meetings().start();
              await hidePopup();
            },
          },
        ]
      : [];
  return {
    items,
    title: state.current ? "Forgor · recording" : undefined,
    status: <RecordingStatus recording={!!state.current} className="mx-3 mb-2" />,
  };
}
