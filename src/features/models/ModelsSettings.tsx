import { useEffect } from "react";
import { CheckCircle2, Download, Trash2, X } from "lucide-react";
import { Row } from "@/features/settings/Row";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ConfirmDialog";
import { showError } from "@/components/Toasts";
import { deleteModel, downloadModels, refreshModels, useModelsStore } from "@/app/models";
import { models, type ModelId, type ModelStatus } from "@/platform/models";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

export const MODEL_INFO: Record<ModelId, { label: string; detail: string }> = {
  speech: { label: "Speech recognition", detail: "Parakeet v3 (NVIDIA): Dutch, English and 23 more languages. Used by meeting recordings" },
  speakers: { label: "Speaker separation", detail: "pyannote + CAM++: tells the other participants of a meeting apart (Spreker 1, 2…). Optional" },
  language: { label: "Language model", detail: "Gemma 4 E4B (Google): meeting summaries and the writing tools" },
};

/** Settings → AI models: every model in one place, downloaded once and shared by the features that use it. */
export function ModelsSettings() {
  const list = useModelsStore((s) => s.models);
  useEffect(() => void refreshModels().catch((e) => showError(e, "AI models")), []);
  return (
    <Row label="AI models" hint="They run on this computer: nothing you record or write is uploaded. Stored in the app's data folder, not in your notes. Each model is stored once, whichever features use it.">
      <div className="space-y-2" data-testid="ai-models">
        {list.map((m) => (
          <ModelRow key={m.id} model={m} />
        ))}
      </div>
    </Row>
  );
}

function useDownloading(model: ModelStatus) {
  const progress = useModelsStore((s) => s.downloads[model.id]);
  const queued = useModelsStore((s) => s.queued.includes(model.id));
  const downloading = model.downloading || (!!progress && !progress.done);
  const pct = progress && progress.total ? Math.round((progress.received / progress.total) * 100) : 0;
  return { progress, queued, downloading, pct };
}

function ModelRow({ model }: { model: ModelStatus }) {
  const { progress, queued, downloading, pct } = useDownloading(model);
  const info = MODEL_INFO[model.id];
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
          <Button size="sm" variant="ghost" onClick={() => void models().cancelDownload(model.id)}>
            <X /> Cancel
          </Button>
        ) : model.downloaded ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              const ok = await confirmDialog({
                title: `Delete the ${info.label.toLowerCase()}?`,
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

export interface ModelNeed {
  id: ModelId;
  optional?: boolean;
  /** What it's used for ("the summary"). */
  for?: string;
}

/**
 * What a plugin needs: a line per model with its state and one button to
 * download what is missing. Deleting is only in Settings → AI models.
 */
export function RequiredModels({ models, testId }: { models: ModelNeed[]; testId?: string }) {
  const all = useModelsStore((s) => s.models);
  const queued = useModelsStore((s) => s.queued);
  const downloads = useModelsStore((s) => s.downloads);
  useEffect(() => void refreshModels().catch((e) => showError(e, "AI models")), []);
  const needed = models.flatMap((n) => {
    const model = all.find((m) => m.id === n.id);
    return model ? [{ need: n, model }] : [];
  });
  const missing = needed.filter((n) => !n.model.downloaded).map((n) => n.model);
  const busy = needed.some(({ model: m }) => queued.includes(m.id) || m.downloading || (downloads[m.id] && !downloads[m.id]!.done));
  return (
    <div className="space-y-2" data-testid={testId}>
      {needed.map(({ need, model }) => (
        <RequiredLine key={model.id} model={model} need={need} />
      ))}
      {missing.length > 0 && !busy && (
        <Button size="sm" variant="outline" onClick={() => downloadModels(missing.map((m) => m.id)).catch((e) => showError(e, "Download failed"))} data-testid={testId && `${testId}-download`}>
          <Download /> Download {missing.length === 1 ? MODEL_INFO[missing[0]!.id].label.toLowerCase() : "models"} ({formatBytes(missing.reduce((n, m) => n + m.sizeBytes, 0))})
        </Button>
      )}
    </div>
  );
}

function RequiredLine({ model, need }: { model: ModelStatus; need: ModelNeed }) {
  const { queued, downloading, pct } = useDownloading(model);
  return (
    <div className="text-[13px]" data-testid={`needs-${model.id}`}>
      <div className="flex items-center gap-1.5">
        {MODEL_INFO[model.id].label}
        {need.optional && <span className="text-xs text-muted-foreground">(optional)</span>}
        {model.downloaded ? (
          <CheckCircle2 className="size-3.5 text-success" aria-label="Downloaded" />
        ) : (
          <span className={cn("text-xs", downloading || queued ? "text-muted-foreground" : "text-destructive")}>
            · {downloading ? `downloading… ${pct}%` : queued ? "waiting…" : `not downloaded (${formatBytes(model.sizeBytes)})`}
          </span>
        )}
      </div>
      {need.for && <p className="text-xs text-muted-foreground">For {need.for}</p>}
    </div>
  );
}
