import { create } from "zustand";
import { onDataChange } from "@/data/context";
import { listFolders } from "@/data/notes";
import { listTodos } from "@/data/todos";
import { deleteIndexRows, listNoteTexts, loadIndex, saveIndexRows } from "@/data/chatIndex";
import { modelReady, useModelsStore } from "@/app/models";
import { chatModels } from "@/platform/chat";
import { isMeetingsPath } from "@/lib/paths";
import { enabledPlugins } from "../host";
import type { PluginChatItem } from "../types";
import { docText, hashText, noteDocs, todoDoc, type ChatDoc } from "./search";

/**
 * Keeps a vector (search model) for every note section, todo and plugin item,
 * so a question finds things by meaning. Runs in the main window while the
 * plugin is on: once at the start, then a few seconds after notes or todos
 * change. Only text that changed is embedded again (its hash differs).
 */

interface IndexState {
  /** Embedding now: how far. */
  progress: { done: number; total: number } | null;
  error: string | null;
}
export const useChatIndex = create<IndexState>(() => ({ progress: null, error: null }));

/** In memory: key → vector and the hash it was made from (loaded from the database once). */
let vectors: Map<string, { hash: string; vec: Float32Array }> | null = null;

/** Plugin items by "<plugin>:<id>", to open them from an answer. */
const items = new Map<string, PluginChatItem>();
export const pluginItem = (key: string) => items.get(key);

/** Everything the chat may search now: notes (in sections), todos and enabled plugins' items. */
export async function buildDocs(): Promise<{ docs: ChatDoc[]; projects: string[]; kinds: string[] }> {
  const [folders, notes, todos] = await Promise.all([listFolders(), listNoteTexts(), listTodos()]);
  const folderPath = new Map(folders.map((f) => [f.id, f.path]));
  const docs: ChatDoc[] = [];
  for (const n of notes) docs.push(...noteDocs(n, n.folderId ? (folderPath.get(n.folderId) ?? "") : isMeetingsPath(n.path) ? "Meetings" : ""));
  for (const t of todos) if (t.status !== "done") docs.push(todoDoc(t, t.folderId ? (folderPath.get(t.folderId) ?? "") : ""));
  for (const p of enabledPlugins()) {
    if (!p.chat || p.id === "chat") continue;
    const list = await p.chat.items().catch((e) => {
      console.warn(`AI chat: ${p.name} items`, e);
      return [] as PluginChatItem[];
    });
    for (const item of list) {
      const key = `${p.id}:${item.id}`;
      items.set(key, item);
      docs.push({ key, kind: "item", plugin: p.id, itemId: item.id, itemKind: p.chat.kind, title: item.title, text: item.text, folder: item.folderId ? (folderPath.get(item.folderId) ?? "") : "" });
    }
  }
  const projects = [...new Set(folders.map((f) => f.path.split("/")[0]))];
  // What the enabled plugins offer, items or not: "no pull requests" and "no pull request plugin" are different answers.
  const kinds = enabledPlugins().flatMap((p) => (p.chat && p.id !== "chat" ? [p.chat.kind] : []));
  return { docs, projects, kinds };
}

const BATCH = 16;
let running: Promise<Map<string, Float32Array>> | null = null;

/**
 * Vectors for `docs`: from the index, embedding what's new or changed (and
 * dropping what's gone). Without the search model: none (word search only).
 */
export function vectorsFor(docs: ChatDoc[]): Promise<Map<string, Float32Array>> {
  if (!modelReady("search")) return Promise.resolve(new Map());
  // One at a time: a question waits for a running update instead of embedding twice.
  const run = (running ?? Promise.resolve(new Map())).then(() => update(docs));
  running = run.finally(() => running === run && (running = null)) as Promise<Map<string, Float32Array>>;
  return run;
}

async function update(docs: ChatDoc[]): Promise<Map<string, Float32Array>> {
  vectors ??= new Map((await loadIndex()).map((r) => [r.key, { hash: r.hash, vec: r.vec }]));
  const stale = docs.filter((d) => vectors!.get(d.key)?.hash !== hashText(docText(d)));
  try {
    if (stale.length) useChatIndex.setState({ progress: { done: 0, total: stale.length }, error: null });
    for (let i = 0; i < stale.length; i += BATCH) {
      const batch = stale.slice(i, i + BATCH);
      const vecs = await chatModels().embed(batch.map(docText));
      const rows = batch.map((d, j) => ({ key: d.key, hash: hashText(docText(d)), vec: vecs[j] }));
      await saveIndexRows(rows);
      for (const r of rows) vectors.set(r.key, { hash: r.hash, vec: r.vec });
      useChatIndex.setState({ progress: { done: Math.min(i + BATCH, stale.length), total: stale.length } });
    }
  } catch (e) {
    useChatIndex.setState({ error: String((e as Error)?.message ?? e) });
    throw e;
  } finally {
    useChatIndex.setState({ progress: null });
  }
  // Gone: deleted notes, sections, finished todos (plugin items too, when the plugin is off).
  const keys = new Set(docs.map((d) => d.key));
  const gone = [...vectors.keys()].filter((k) => !keys.has(k));
  if (gone.length) {
    await deleteIndexRows(gone);
    for (const k of gone) vectors.delete(k);
  }
  return new Map([...vectors].map(([k, v]) => [k, v.vec]));
}

/** The question's vector (null without the search model). */
export async function questionVector(text: string): Promise<Float32Array | null> {
  if (!modelReady("search")) return null;
  return (await chatModels().embed([text]))[0] ?? null;
}

/** The plugin's `start`: index now, after changes, and when the search model arrives. */
export function startChatIndex(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const later = (ms: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void buildDocs().then(({ docs }) => vectorsFor(docs)).catch((e) => console.warn("AI chat index", e)), ms);
  };
  later(3000);
  const offData = onDataChange((topics) => {
    if (topics.includes("notes") || topics.includes("todos")) later(5000);
  });
  const offModels = useModelsStore.subscribe((s, prev) => {
    const ready = s.models.find((m) => m.id === "search")?.downloaded;
    if (ready && !prev.models.find((m) => m.id === "search")?.downloaded) later(500);
  });
  return () => {
    if (timer) clearTimeout(timer);
    offData();
    offModels();
  };
}
