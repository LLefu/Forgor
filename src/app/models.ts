import { create } from "zustand";
import { models, type DownloadProgress, type ModelId, type ModelStatus } from "@/platform/models";

/**
 * The AI models at runtime: what is downloaded, download progress and the
 * download queue. Shared by every feature that uses a model; features read
 * `useModelReady` and never download or delete on their own terms.
 */
interface ModelsState {
  models: ModelStatus[];
  downloads: Partial<Record<ModelId, DownloadProgress>>;
  /** Models waiting for their turn in "Download models". */
  queued: ModelId[];
}

export const useModelsStore = create<ModelsState>(() => ({ models: [], downloads: {}, queued: [] }));

export function useModel(id: ModelId): ModelStatus | undefined {
  return useModelsStore((s) => s.models.find((m) => m.id === id));
}

export function useModelReady(id: ModelId): boolean {
  return useModelsStore((s) => s.models.some((m) => m.id === id && m.downloaded));
}

export function modelReady(id: ModelId): boolean {
  return useModelsStore.getState().models.some((m) => m.id === id && m.downloaded);
}

export async function refreshModels() {
  useModelsStore.setState({ models: await models().list() });
}

/** Download the missing models among `ids` (all when omitted), one after the other. */
export async function downloadModels(ids?: ModelId[]) {
  const missing = useModelsStore.getState().models.filter((m) => !m.downloaded && (!ids || ids.includes(m.id)));
  useModelsStore.setState((s) => ({ queued: [...new Set([...s.queued, ...missing.map((m) => m.id)])] }));
  try {
    for (const m of missing) {
      useModelsStore.setState((s) => ({ queued: s.queued.filter((q) => q !== m.id) }));
      await models().download(m.id);
      await refreshModels();
    }
  } catch (e) {
    if (!/cancelled/i.test(String((e as Error)?.message ?? e))) throw e;
  } finally {
    useModelsStore.setState((s) => ({ queued: s.queued.filter((q) => !missing.some((m) => m.id === q)) }));
    await refreshModels();
  }
}

export async function deleteModel(id: ModelId) {
  await models().delete(id);
  useModelsStore.setState((s) => ({ downloads: { ...s.downloads, [id]: undefined } }));
  await refreshModels();
}

/** Main window: follow download progress. Returns an unsubscribe function. */
export function startModels(): () => void {
  const off = models().onDownload((p) => useModelsStore.setState((s) => ({ downloads: { ...s.downloads, [p.id]: p } })));
  void refreshModels();
  return () => void off.then((o) => o());
}
