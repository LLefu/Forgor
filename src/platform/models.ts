import { isTauri } from "./env";
import { onTauriEvent } from "./events";

/**
 * The downloadable AI models (Rust, src-tauri/src/models), shared by every
 * feature that uses them: meeting recordings, writing tools, later plugins.
 * Features ask for a model by id; downloading and deleting happens here only.
 * The browser build (dev, demo, e2e) gets a fake that "downloads" instantly.
 */

export type ModelId = "speech" | "speakers" | "language";

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

export interface ModelsBackend {
  list(): Promise<ModelStatus[]>;
  download(id: ModelId): Promise<void>;
  cancelDownload(id: ModelId): Promise<void>;
  delete(id: ModelId): Promise<void>;
  onDownload(cb: (e: DownloadProgress) => void): Promise<() => void>;
}

let backend: ModelsBackend | null = null;

export function models(): ModelsBackend {
  backend ??= isTauri() ? tauriBackend() : memoryBackend();
  return backend;
}

// ---------------------------------------------------------------- desktop

function tauriBackend(): ModelsBackend {
  const invoke = async <T>(cmd: string, args?: Record<string, unknown>) => (await import("@tauri-apps/api/core")).invoke<T>(cmd, args);
  return {
    list: () => invoke("models_list"),
    download: (id) => invoke("models_download", { id }),
    cancelDownload: (id) => invoke("models_cancel_download", { id }),
    delete: (id) => invoke("models_delete", { id }),
    onDownload: async (cb) => onTauriEvent<DownloadProgress>("wn://model-download", cb),
  };
}

// ---------------------------------------------------------------- browser fake

const FAKE_SIZES: Record<ModelId, number> = { speech: 671_122_626, speakers: 34_274_077, language: 4_590_807_392 };

function memoryBackend(): ModelsBackend {
  const downloaded = new Set<ModelId>();
  const downloading = new Set<ModelId>();
  const listeners = new Set<(e: DownloadProgress) => void>();
  const tick = () => new Promise((r) => setTimeout(r, 30));
  return {
    list: async () =>
      (Object.keys(FAKE_SIZES) as ModelId[]).map((id) => ({ id, sizeBytes: FAKE_SIZES[id], downloaded: downloaded.has(id), downloading: downloading.has(id), path: `memory://models/${id}` })),
    download: async (id) => {
      downloading.add(id);
      const total = FAKE_SIZES[id];
      for (let i = 1; i <= 5; i++) {
        await tick();
        listeners.forEach((l) => l({ id, received: (total * i) / 5, total, done: i === 5, error: null }));
      }
      downloading.delete(id);
      downloaded.add(id);
    },
    cancelDownload: async () => {},
    delete: async (id) => void downloaded.delete(id),
    onDownload: (cb) => {
      listeners.add(cb);
      return Promise.resolve(() => void listeners.delete(cb));
    },
  };
}

/** Whether a model is downloaded (for code that checks once, like the browser fakes). */
export async function isDownloaded(id: ModelId): Promise<boolean> {
  return (await models().list()).some((m) => m.id === id && m.downloaded);
}
