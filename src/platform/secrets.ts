import { isTauri } from "./env";

/**
 * Small secrets in the OS keychain (Rust: src-tauri/src/secrets.rs), by name,
 * e.g. the plugin store's publish keys. The browser build keeps them in memory.
 */
export interface Secrets {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
}

let backend: Secrets | null = null;

export function secrets(): Secrets {
  backend ??= isTauri() ? tauriSecrets() : memorySecrets();
  return backend;
}

function tauriSecrets(): Secrets {
  const invoke = async <T>(cmd: string, args: Record<string, unknown>) => (await import("@tauri-apps/api/core")).invoke<T>(cmd, args);
  return {
    get: (name) => invoke("secret_get", { name }),
    set: (name, value) => invoke("secret_set", { name, value }),
    delete: (name) => invoke("secret_delete", { name }),
  };
}

function memorySecrets(): Secrets {
  const values = new Map<string, string>();
  return {
    get: async (name) => values.get(name) ?? null,
    set: async (name, value) => void values.set(name, value),
    delete: async (name) => void values.delete(name),
  };
}
