import { isTauri } from "./env";

/**
 * Writing tools: the local language model (Rust, src-tauri/src/writing.rs)
 * rewrites text following an instruction. The browser build gets a fake.
 */

export interface WriteRequest {
  instruction: string;
  /** Selected markdown; empty = write at the cursor. */
  selection: string;
  /** The whole note (context). */
  document: string;
}

/**
 * Streams the reply in pieces. Aborting the signal stops the model. At the end,
 * `onWarnings` gets what the reply loses or repeats compared with the selection
 * ("leaves out 1 image"), checked in code; empty when nothing.
 */
export type WriteFn = (request: WriteRequest, signal: AbortSignal, onWarnings?: (warnings: string[]) => void) => AsyncIterable<string>;

let lastId = 0;
/** Increasing across reloads too: the native side cancels "this id and everything before it". */
const nextId = () => (lastId = Math.max(lastId + 1, Date.now()));

export function writer(): WriteFn {
  return isTauri() ? tauriWrite : fakeWrite;
}

/** Turns callbacks (the native channel) into an async iterable. */
function pieces(start: (push: (piece: string) => void) => Promise<void>, signal: AbortSignal): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      const queue: string[] = [];
      let wake: (() => void) | null = null;
      let done = false;
      let error: unknown = null;
      const notify = () => {
        wake?.();
        wake = null;
      };
      signal.addEventListener("abort", notify);
      start((p) => {
        queue.push(p);
        notify();
      })
        .catch((e) => (error = e))
        .finally(() => {
          done = true;
          notify();
        });
      while (!signal.aborted) {
        if (queue.length) yield queue.shift()!;
        else if (error) throw error;
        else if (done) return;
        else await new Promise<void>((r) => (wake = r));
      }
    },
  };
}

const tauriWrite: WriteFn = (request, signal, onWarnings) =>
  pieces(async (push) => {
    const { invoke, Channel } = await import("@tauri-apps/api/core");
    const id = nextId();
    const onPiece = new Channel<string>();
    onPiece.onmessage = push;
    const cancel = () => void invoke("writing_cancel", { id });
    signal.addEventListener("abort", cancel);
    try {
      const outcome = await invoke<{ warnings: string[] }>("writing_run", { request: { id, ...request }, onPiece });
      if (!signal.aborted) onWarnings?.(outcome.warnings);
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  }, signal);

/** Browser build (demo, e2e): a canned "rewrite", streamed word by word. "zonder afbeeldingen" drops the images (to test the warning), "?" gets no answer. */
const fakeWrite: WriteFn = (request, signal, onWarnings) =>
  pieces(async (push) => {
    let selection = request.selection.trim();
    const dropImages = /zonder afbeeldingen/.test(request.instruction) && /!\[/.test(selection);
    if (dropImages) selection = selection.replace(/!\[[^\]]*\]\([^)]*\)/g, "").trim();
    if (request.instruction.trim() === "?") return; // no answer (the real model does this too)
    const text = selection ? `${selection} (herschreven: ${request.instruction.trim()})` : `Nieuwe tekst: ${request.instruction.trim()}`;
    for (const word of text.split(/(?<= )/)) {
      if (signal.aborted) return;
      await new Promise((r) => setTimeout(r, 20));
      push(word);
    }
    onWarnings?.(dropImages ? ["leaves out 1 image"] : []);
  }, signal);
