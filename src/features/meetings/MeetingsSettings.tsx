import { useEffect, useState } from "react";
import { CheckCircle2, Download, Trash2, X } from "lucide-react";
import { Row } from "@/features/settings/Row";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { confirmDialog } from "@/components/ConfirmDialog";
import { showError } from "@/components/Toasts";
import { useUI } from "@/app/store";
import { configureNative, deleteModel, downloadModels, refreshModels, useMeetingsStore } from "@/app/meetings";
import { meetings, type ModelId, type ModelStatus } from "@/platform/meetings";
import { formatBytes } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";
import { forgetVoice, listVoices } from "@/data/voices";

const MODEL_INFO: Record<ModelId, { label: string; detail: string }> = {
  speech: { label: "Speech recognition", detail: "Parakeet v3 (NVIDIA): Dutch, English and 23 more languages" },
  speakers: { label: "Speaker separation", detail: "pyannote + CAM++: tells the other participants apart (Spreker 1, 2…). Optional" },
  summary: { label: "Summaries", detail: "Gemma 4 E4B (Google): summary, key points and action items" },
};

/** Settings → Meeting recordings: the feature toggle, the models (download / delete), mic and language. */
export function MeetingsSettings({ desktop }: { desktop: boolean }) {
  const settings = useUI((s) => s.settings);
  const update = useUI((s) => s.updateSetting);
  const models = useMeetingsStore((s) => s.models);
  const recording = useMeetingsStore((s) => !!s.current);
  const [devices, setDevices] = useState<string[]>([]);

  useEffect(() => {
    if (!settings.meetingsEnabled) return;
    void refreshModels();
    meetings()
      .inputDevices()
      .then((d) => setDevices(d.devices))
      .catch(() => setDevices([]));
  }, [settings.meetingsEnabled]);

  const toggle = async (on: boolean) => {
    await update("meetingsEnabled", on);
    await configureNative();
  };
  const downloads = useMeetingsStore((s) => s.downloads);
  const queued = useMeetingsStore((s) => s.queued);
  const missing = models.filter((m) => !m.downloaded);
  const busy = queued.length > 0 || models.some((m) => m.downloading || (downloads[m.id] && !downloads[m.id]!.done));

  return (
    <>
      <Row
        label="Meeting recordings"
        hint={`Record meetings and get a transcript and summary, made on this computer: nothing is uploaded.${desktop ? "" : " (The browser build uses a demo transcript.)"}`}
      >
        <div className="flex items-center gap-2">
          <Switch
            checked={settings.meetingsEnabled}
            onCheckedChange={(v) => void toggle(v)}
            disabled={recording}
            aria-label="Meeting recordings"
            data-testid="meetings-toggle"
          />
          <span className="text-sm">{settings.meetingsEnabled ? "On" : "Off"}</span>
        </div>
        {settings.meetingsEnabled && (
          <div className="mt-4 space-y-2" data-testid="meeting-models">
            {models.map((m) => (
              <ModelRow key={m.id} model={m} />
            ))}
            {missing.length > 0 && !busy && (
              <Button
                size="sm"
                onClick={() => downloadModels().catch((e) => showError(e, "Download failed"))}
                data-testid="download-models"
              >
                <Download /> Download {missing.length === models.length ? "models" : "missing model"} ({formatBytes(missing.reduce((n, m) => n + m.sizeBytes, 0))})
              </Button>
            )}
            <p className="text-xs text-muted-foreground">Models are stored in the app's data folder, not in your notes. The speech model is needed to record. Without speaker separation the others are one "Anderen"; without the summary model you get only the transcript.</p>
          </div>
        )}
      </Row>

      {settings.meetingsEnabled && (
        <>
          <Row label="Microphone" hint="Your voice is recorded from this microphone. The other people in a call come from the computer's sound.">
            <Select<string>
              aria-label="Microphone"
              value={settings.meetingMic ?? ""}
              onChange={async (v) => {
                await update("meetingMic", v || null);
                await configureNative();
              }}
              options={[{ value: "", label: "System default" }, ...devices.map((d) => ({ value: d, label: d }))]}
              className="max-w-80"
            />
          </Row>
          <KnownVoicesRow />
          <Row label="Summary language" hint="Dutch and English speech are both recognized, also mixed. This sets the language of the summary and labels.">
            <Select
              aria-label="Summary language"
              value={settings.meetingLanguage}
              onChange={(v) => update("meetingLanguage", v)}
              options={[
                { value: "auto", label: "Same as the meeting" },
                { value: "nl", label: "Always Dutch" },
                { value: "en", label: "Always English" },
              ]}
            />
          </Row>
        </>
      )}
    </>
  );
}

function ModelRow({ model }: { model: ModelStatus }) {
  const progress = useMeetingsStore((s) => s.downloads[model.id]);
  const queued = useMeetingsStore((s) => s.queued.includes(model.id));
  const info = MODEL_INFO[model.id];
  const downloading = model.downloading || (progress && !progress.done);
  const pct = progress && progress.total ? Math.round((progress.received / progress.total) * 100) : 0;
  return (
    <div className="rounded border px-3 py-2" data-testid={`model-${model.id}`}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            {info.label}
            {model.downloaded && <CheckCircle2 className="size-3.5 text-success" aria-label="Downloaded" />}
          </div>
          <div className="text-xs text-muted-foreground">
            {info.detail} · {formatBytes(model.sizeBytes)}
            {!model.downloaded && !downloading && (queued ? " · waiting…" : " · not downloaded")}
          </div>
        </div>
        {queued && !downloading ? null : downloading ? (
          <Button size="sm" variant="ghost" onClick={() => void meetings().cancelDownload(model.id)}>
            <X /> Cancel
          </Button>
        ) : model.downloaded ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              const ok = await confirmDialog({
                title: `Delete the ${info.label.toLowerCase()} model?`,
                message: `This frees ${formatBytes(model.sizeBytes)}. You can download it again at any time.`,
                confirmLabel: "Delete",
                destructive: true,
              });
              if (ok) await deleteModel(model.id).catch((e) => showError(e, "Could not delete the model"));
            }}
            data-testid={`delete-model-${model.id}`}
          >
            <Trash2 /> Delete
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => downloadModels([model.id]).catch((e) => showError(e, "Download failed"))}>
            <Download /> Download
          </Button>
        )}
      </div>
      {downloading && (
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          <span className="w-24 text-right text-xs tabular-nums text-muted-foreground">
            {pct}% of {formatBytes(model.sizeBytes)}
          </span>
        </div>
      )}
      {progress?.error && !downloading && <p className="mt-1 text-xs text-destructive">{progress.error}</p>}
    </div>
  );
}

/** The people Forgor recognizes by voice, with a way to forget them. */
function KnownVoicesRow() {
  const { data: voices = [] } = useQuery({ queryKey: ["voices"], queryFn: listVoices });
  return (
    <Row
      label="Known voices"
      hint="When you name a speaker, Forgor remembers their voice and fills in the name in later meetings. A voice fingerprint is about 2 KB, stored only in the app's database on this computer, never in your notes."
    >
      {voices.length === 0 ? (
        <p className="text-xs text-muted-foreground">None yet. Name the speakers of a recording to add them.</p>
      ) : (
        <ul className="divide-y rounded border" data-testid="known-voices">
          {voices.map((v) => (
            <li key={v.name} className="flex items-center gap-2 px-2.5 py-1.5">
              <span className="flex-1 text-[13px]">{v.name}</span>
              <span className="text-xs text-muted-foreground">
                {v.meetings} {v.meetings === 1 ? "meeting" : "meetings"}
              </span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Forget ${v.name}'s voice`}
                onClick={async () => {
                  const ok = await confirmDialog({
                    title: `Forget ${v.name}'s voice?`,
                    message: "Forgor won't recognize them anymore. Names already in your notes stay.",
                    confirmLabel: "Forget",
                    destructive: true,
                  });
                  if (ok) await forgetVoice(v.name);
                }}
              >
                <Trash2 /> Forget
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Row>
  );
}
