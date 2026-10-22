import { isTauri } from "./env";
import { pieces } from "./writing";

/**
 * The AI chat's two model calls (Rust: src-tauri/src/models/embed.rs and
 * src-tauri/src/chat.rs). `embed`: a vector per text for search by meaning;
 * `answer`: the language model's reply, streamed. The browser build gets fakes
 * (word-hash vectors, a canned answer citing the first source) for the demo and e2e.
 */

export interface ChatTurn {
  role: "user" | "model";
  text: string;
}

export interface ChatBackend {
  embed(texts: string[]): Promise<Float32Array[]>;
  answer(request: { system: string; turns: ChatTurn[] }, signal: AbortSignal): AsyncIterable<string>;
}

let lastId = 0;
/** Increasing across reloads too: the native side cancels "this id and everything before it". */
const nextId = () => (lastId = Math.max(lastId + 1, Date.now()));

let backend: ChatBackend | null = null;
export function chatModels(): ChatBackend {
  backend ??= isTauri() ? tauriBackend() : fakeBackend();
  return backend;
}

function tauriBackend(): ChatBackend {
  return {
    async embed(texts) {
      const { invoke } = await import("@tauri-apps/api/core");
      const out = await invoke<number[][]>("search_embed", { texts });
      return out.map((v) => Float32Array.from(v));
    },
    answer: (request, signal) =>
      pieces(async (push) => {
        const { invoke, Channel } = await import("@tauri-apps/api/core");
        const id = nextId();
        const onPiece = new Channel<string>();
        onPiece.onmessage = push;
        const cancel = () => void invoke("chat_cancel", { id });
        signal.addEventListener("abort", cancel);
        try {
          await invoke("chat_run", { request: { id, ...request }, onPiece });
        } finally {
          signal.removeEventListener("abort", cancel);
        }
      }, signal),
  };
}

// ---------------------------------------------------------------- browser fake

const DIM = 256;
const words = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length > 2);

/** Words hashed into buckets (by their first 5 letters): texts sharing words point the same way. */
function fakeVector(text: string): Float32Array {
  const v = new Float32Array(DIM);
  for (const w of words(text.replace(/^(title|task): [^|]*\|\s*(text|query):/i, ""))) {
    let h = 2166136261;
    for (const c of w.slice(0, 5)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    v[(h >>> 0) % DIM] += 1;
  }
  const len = Math.hypot(...v) || 1;
  return v.map((x) => x / len);
}

function fakeBackend(): ChatBackend {
  return {
    embed: async (texts) => texts.map(fakeVector),
    answer: (request, signal) =>
      pieces(async (push) => {
        // "[1] Notitie "Title" (…)" lines are the sources in the question.
        const question = request.turns[request.turns.length - 1]?.text ?? "";
        const first = question.match(/^\[1\] [^"]*"([^"]+)"/m);
        const text = first ? `Ik vond dit in "${first[1]}" [1].` : "Ik kan daar niets over vinden in je notities.";
        for (const word of text.split(/(?<= )/)) {
          if (signal.aborted) return;
          await new Promise((r) => setTimeout(r, 15));
          push(word);
        }
      }, signal),
  };
}
