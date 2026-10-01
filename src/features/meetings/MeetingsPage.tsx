import { useEffect } from "react";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, AudioLines, Loader2, RefreshCw, RotateCw, Settings, Trash2, Users } from "lucide-react";
import { PageHeader } from "@/features/todos/TodosPage";
import { FolderSelect } from "@/features/folder/folderColors";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { confirmDialog } from "@/components/ConfirmDialog";
import { useMeetings } from "@/app/queries";
import { useUI } from "@/app/store";
import { noteLinkProps } from "@/app/noteLink";
import { downloadModels, processMeeting, refreshModels, useMeetingsStore, useRecordingAvailable } from "@/app/meetings";
import { showError } from "@/components/Toasts";
import { formatBytes } from "@/lib/format";
import { assignFolder, deleteMeeting, hasSpeakers, type Meeting } from "@/data/meetings";
import { formatDuration } from "@/lib/meetingNote";
import { meetings } from "@/platform/meetings";
import { isTauri } from "@/platform/env";

/** Only the dev desktop app keeps the audio after transcribing, so only it can transcribe again. */
const DEV_RETRANSCRIBE = import.meta.env.DEV && isTauri();
import { RecordButton } from "./RecordButton";
import { RecordingStatus } from "./RecordingStatus";

export function MeetingsPage() {
  const { data: list = [] } = useMeetings();
  const available = useRecordingAvailable();
  const recording = useMeetingsStore((s) => !!s.current);
  const setView = useUI((s) => s.setView);
  // Models can change outside this page (downloads, deletes, files put in place by hand).
  useEffect(() => void refreshModels().catch(() => {}), []);

  return (
    <div className="mx-auto max-w-3xl pb-16">
      <PageHeader title="Meetings" subtitle="Recordings are transcribed and summarized on this computer. Nothing is uploaded.">
        <RecordButton />
      </PageHeader>
      <div className="px-8">
        {!available ? (
          <div className="mb-6 flex items-center gap-3 rounded border bg-muted/40 p-3 text-sm" data-testid="meetings-setup">
            <Settings className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1">Download the speech model in Settings to start recording.</span>
            <Button size="sm" variant="outline" onClick={() => setView({ kind: "settings" })}>
              Open Settings
            </Button>
          </div>
        ) : (
          <p className="mb-6 text-xs text-muted-foreground">
            Records your microphone and everything your computer plays (the other people in a call). Let people know you're recording; in many places that's
            required.
          </p>
        )}
        {available && <MissingSpeakersNotice />}
        <RecordingStatus recording={recording} className="mb-6 rounded border p-3" />

        {list.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No recordings yet.</p>
        ) : (
          <ul className="divide-y rounded border" data-testid="meetings-list">
            {list.map((m) => (
              <MeetingRow key={m.id} meeting={m} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** The optional speaker separation is easy to miss: say what it adds, with the download right here. */
function MissingSpeakersNotice() {
  const model = useMeetingsStore((s) => s.models.find((m) => m.id === "speakers"));
  const progress = useMeetingsStore((s) => s.downloads.speakers);
  if (!model || model.downloaded) return null;
  const busy = model.downloading || (progress && !progress.done);
  return (
    <div className="mb-6 flex items-center gap-3 rounded border bg-muted/40 p-3 text-sm" data-testid="speakers-missing">
      <Users className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex-1">
        Without speaker separation, everyone else shows as one “Anderen”. Download it to tell them apart and name them.
      </span>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => downloadModels(["speakers"]).catch((e) => showError(e, "Download failed"))}>
        {busy ? `Downloading… ${progress?.total ? Math.round((progress.received / progress.total) * 100) : 0}%` : `Download (${formatBytes(model.sizeBytes)})`}
      </Button>
    </div>
  );
}

function MeetingRow({ meeting: m }: { meeting: Meeting }) {
  const progress = useMeetingsStore((s) => s.progress[m.id]);
  const { data: withAudio = [] } = useQuery({
    queryKey: ["recordings-with-audio"],
    queryFn: async () => (await meetings().recordings()).map((r) => r.id),
    enabled: DEV_RETRANSCRIBE,
  });
  const started = new Date(m.startedAt);
  return (
    <li className="flex items-center gap-3 px-3 py-2.5" data-testid="meeting-row" data-title={m.note?.title}>
      <AudioLines className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <button className="block max-w-full truncate text-left text-sm font-medium hover:underline" {...noteLinkProps(m.noteId!)}>
          {m.note?.title}
        </button>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            {format(started, "EEE d MMM yyyy, HH:mm")} · {formatDuration(m.durationSec)}
          </span>
          <Status meeting={m} progress={progress} />
        </div>
      </div>
      <FolderSelect
        value={m.folderId}
        onChange={(folderId) => void assignFolder(m.id, folderId)}
        noneLabel="Unassigned"
        className="max-w-48 shrink-0"
        testId="meeting-folder"
      />
      {hasSpeakers(m) && (
        <Tooltip content="Name the speakers">
          <Button size="icon" variant="ghost" onClick={() => useMeetingsStore.getState().setSpeakersOf(m.id)} aria-label="Name the speakers" data-testid="name-speakers">
            <Users />
          </Button>
        </Tooltip>
      )}
      {DEV_RETRANSCRIBE && m.status === "done" && withAudio.includes(m.id) && (
        <Tooltip content="Transcribe again (dev only: the dev app keeps the audio)">
          <Button size="icon" variant="ghost" onClick={() => void processMeeting(m.id)} aria-label="Transcribe again" data-testid="transcribe-again">
            <RefreshCw />
          </Button>
        </Tooltip>
      )}
      {m.status === "failed" && (
        <Tooltip content="Try again">
          <Button size="icon" variant="ghost" onClick={() => void processMeeting(m.id)} aria-label="Try again">
            <RotateCw />
          </Button>
        </Tooltip>
      )}
      <Tooltip content="Delete recording">
        <Button
          size="icon"
          variant="ghost"
          aria-label="Delete recording"
          onClick={async () => {
            const ok = await confirmDialog({
              title: `Delete "${m.note?.title}"?`,
              message: "The note moves to the Trash, so you can restore it from there.",
              confirmLabel: "Delete",
              destructive: true,
            });
            if (ok) {
              await deleteMeeting(m.id);
              await meetings().discard(m.id); // kept audio (dev, failed) would otherwise come back as a recovered recording
            }
          }}
        >
          <Trash2 />
        </Button>
      </Tooltip>
    </li>
  );
}

function Status({ meeting, progress }: { meeting: Meeting; progress?: { stage: string; progress: number } }) {
  if (meeting.status === "failed") {
    return (
      <span className="flex min-w-0 items-center gap-1 text-destructive" title={meeting.error ?? undefined}>
        <AlertCircle className="size-3.5 shrink-0" /> <span className="truncate">Failed: {meeting.error}</span>
      </span>
    );
  }
  if (meeting.status !== "processing") return null;
  const label = progress?.stage === "summarizing" ? "Summarizing" : progress ? "Transcribing" : "Waiting";
  return (
    <span className="flex items-center gap-1 text-primary" data-testid="meeting-processing">
      <Loader2 className="size-3.5 animate-spin" /> {label}
      {progress && ` ${Math.round(progress.progress * 100)}%`}
    </span>
  );
}
