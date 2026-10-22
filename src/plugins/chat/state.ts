import { create } from "zustand";
import { getPluginValue, setPluginValue } from "@/data/pluginStorage";
import { showError } from "@/components/Toasts";
import { todayStr } from "@/lib/dates";
import { newId } from "@/lib/utils";
import { chatModels, type ChatTurn } from "@/platform/chat";
import { buildDocs, pluginItem, questionVector, vectorsFor } from "./indexer";
import { capAttached, citedNumbers, historyTurns, findSources, namedItems, queryText, questionTurn, refersToAttached, sticksToAttachment, systemPrompt, type ChatDoc } from "./search";

/**
 * The one conversation (kept in plugin storage, so it survives a restart;
 * "New chat" clears it). A question: find sources (search.ts), then the
 * language model answers from them, streamed.
 */

/** Something an answer used or the user attached, enough to show and open it later. */
export interface SourceRef {
  key: string;
  kind: "note" | "todo" | "item";
  title: string;
  /** note id, todo id, or the plugin item's id */
  id: string;
  plugin?: string;
  /** "Jira ticket" */
  itemKind?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** User: what was attached ("@"). Assistant: the sources it was given, numbered like its [n]. */
  sources: SourceRef[];
  /** Assistant: still finding / writing. */
  status?: "searching" | "writing";
  error?: string;
}

interface ChatState {
  loaded: boolean;
  messages: ChatMessage[];
  busy: boolean;
}

export const useChat = create<ChatState>(() => ({ loaded: false, messages: [], busy: false }));

const KEY = "conversation";
let abort: AbortController | null = null;

export async function loadConversation() {
  if (useChat.getState().loaded) return;
  const messages = await getPluginValue<ChatMessage[]>("chat", KEY, []);
  // An answer cut off by closing the app: keep what it had.
  useChat.setState({ loaded: true, messages: messages.map((m) => ({ ...m, status: undefined })) });
}

const save = () => setPluginValue("chat", KEY, useChat.getState().messages).catch((e) => showError(e, "Couldn't save the chat"));

function update(id: string, patch: Partial<ChatMessage>) {
  useChat.setState((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
}

export const refOf = (d: ChatDoc): SourceRef => ({
  key: d.key,
  kind: d.kind,
  title: d.title,
  id: d.kind === "note" ? d.noteId! : d.kind === "todo" ? d.todo!.id : d.itemId!,
  plugin: d.plugin,
  itemKind: d.itemKind,
});

/** A pasted wall of text would make the prompt huge (and slow); the question is cut here. */
export const MAX_QUESTION = 4000;

export async function ask(rawQuestion: string, attached: SourceRef[]) {
  const question = rawQuestion.trim().slice(0, MAX_QUESTION);
  if (useChat.getState().busy || !question) return;
  const before = useChat.getState().messages;
  // "What is the ticket about" after an attachment is still about that item. The chip stays, so the next follow-up finds it too.
  const earlier = [...before].reverse().find((m) => m.role === "user" && m.sources.length)?.sources ?? [];
  let pinned = attached.length ? attached : sticksToAttachment(question) || refersToAttached(question) ? earlier : [];
  const user: ChatMessage = { id: newId(), role: "user", text: question, sources: pinned };
  const answer: ChatMessage = { id: newId(), role: "assistant", text: "", sources: [], status: "searching" };
  useChat.setState({ messages: [...before, user, answer], busy: true });
  abort = new AbortController();
  const signal = abort.signal;
  try {
    const { docs, projects, kinds } = await buildDocs();
    // "What is NZP-41 about" without attaching it: the typed key is as good as an attachment (it gets its description).
    const named = namedItems(question, docs).filter((d) => !pinned.some((p) => p.key === d.key));
    if (named.length) {
      pinned = [...pinned, ...named.map(refOf)];
      update(user.id, { sources: pinned });
    }
    const [vectors, queryVector] = await Promise.all([vectorsFor(docs), questionVector(queryText(question))]);
    const previousQuestion = [...before].reverse().find((m) => m.role === "user")?.text ?? null;
    const found = findSources({ question, previousQuestion, docs, vectors, queryVector, projects, today: todayStr(), itemKinds: kinds });
    // Attached ones first, whole (all sections of an attached note). A question that only points at them ("what is this about") gets nothing else: "ticket" or "talk" would otherwise pull in whatever is nearby.
    const attachedDocs = capAttached(pinned.flatMap((a) => docs.filter((d) => (a.kind === "note" ? d.noteId === a.id : d.key === a.key))));
    // An attached ticket or pull request: its full text (description, comments). The short line is only status and title.
    for (const d of attachedDocs) {
      const detail = d.kind === "item" ? pluginItem(d.key)?.detail : undefined;
      if (detail) d.text = await detail().catch(() => d.text);
    }
    found.sources =
      attachedDocs.length && sticksToAttachment(question, named.map((d) => d.itemId!)) ? attachedDocs : [...attachedDocs, ...found.sources.filter((d) => !attachedDocs.includes(d))];
    update(answer.id, { sources: found.sources.map(refOf), status: "writing" });
    if (signal.aborted) return;

    let text = "";
    const turns: ChatTurn[] = [...historyTurns(before), { role: "user", text: questionTurn(question, found, attachedDocs.length) }];
    for await (const piece of chatModels().answer({ system: systemPrompt(todayStr()), turns }, signal)) {
      text += piece;
      update(answer.id, { text });
    }
    if (!text.trim() && !signal.aborted) update(answer.id, { error: "The model didn't answer. Try asking it differently." });
  } catch (e) {
    update(answer.id, { error: String((e as Error)?.message ?? e) });
  } finally {
    update(answer.id, { status: undefined });
    useChat.setState({ busy: false });
    abort = null;
    void save();
  }
}

export function stop() {
  abort?.abort();
}

export function clearChat() {
  stop();
  useChat.setState({ messages: [] });
  void save();
}

/** The sources an answer cites ([n]), in order (none when it says it can't find anything). */
export function citedSources(m: ChatMessage): SourceRef[] {
  return citedNumbers(m.text)
    .map((n) => m.sources[n - 1])
    .filter((s): s is SourceRef => !!s);
}
