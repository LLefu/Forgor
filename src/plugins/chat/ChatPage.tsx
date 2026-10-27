import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, AtSign, FileText, ListTodo, Loader2, MessageSquarePlus, Puzzle, Sparkles, Square, X } from "lucide-react";
import { useUI } from "@/app/store";
import { useNotes, useTodos } from "@/app/queries";
import { noteLinkProps } from "@/app/noteLink";
import { useModelReady } from "@/app/models";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { PageHeader } from "@/features/todos/TodosPage";
import { RequiredModels } from "@/features/models/ModelsSettings";
import { cn } from "@/lib/utils";
import { enabledPlugins } from "../host";
import { buildDocs, pluginItem, useChatIndex } from "./indexer";
import { ask, citedSources, clearChat, loadConversation, stop, useChat, type ChatMessage, type SourceRef } from "./state";
import { CHAT_MODELS } from "./models";
import { chatExamples } from "./examples";

/** The AI chat: ask about your notes, todos (and tickets, pull requests); answers link to what they used. */
export function ChatPage() {
  const messages = useChat((s) => s.messages);
  const busy = useChat((s) => s.busy);
  const language = useModelReady("language");
  const search = useModelReady("search");
  const ready = language && search;
  const progress = useChatIndex((s) => s.progress);
  const indexError = useChatIndex((s) => s.error);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => void loadConversation(), []);
  // Follow the answer as it streams in.
  const last = messages[messages.length - 1];
  useEffect(() => {
    // Not as an expression: Chromium's scrollIntoView returns a promise now, which React would take as the cleanup.
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, last?.text, last?.status]);

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col" data-testid="chat-page">
      <PageHeader title="Chat" subtitle="Ask about your notes and todos. Runs on this computer: nothing is uploaded." icon={<Sparkles className="size-5 text-muted-foreground" />}>
        {messages.length > 0 && (
          <Button variant="outline" size="sm" onClick={clearChat} data-testid="chat-new">
            <MessageSquarePlus /> New chat
          </Button>
        )}
      </PageHeader>

      <div className="flex-1 space-y-5 px-8 pb-4">
        {!ready ? (
          <div className="rounded border bg-muted/30 p-4" data-testid="chat-models">
            <p className="mb-3 text-sm">The chat needs two AI models on this computer: one to find what you mean, one to write the answer.</p>
            <RequiredModels models={CHAT_MODELS} testId="chat-required" />
          </div>
        ) : messages.length === 0 ? (
          <Examples />
        ) : (
          messages.map((m) => (m.role === "user" ? <Question key={m.id} message={m} /> : <Answer key={m.id} message={m} />))
        )}
        {progress && (
          <p className="text-xs text-muted-foreground" data-testid="chat-indexing">
            Getting your notes ready for search… {progress.done}/{progress.total}
          </p>
        )}
        {indexError && <p className="text-xs text-destructive">Search by meaning isn't working: {indexError}</p>}
        <div ref={end} />
      </div>

      {ready && (
        <div className="sticky bottom-0 bg-background px-8 pb-6 pt-2">
          <Composer busy={busy} />
        </div>
      )}
    </div>
  );
}

function Examples() {
  const kinds = enabledPlugins().flatMap((p) => (p.chat && p.id !== "chat" ? [p.chat.kind] : []));
  return (
    <div className="py-6 text-center" data-testid="chat-empty">
      <p className="text-sm text-muted-foreground">Ask something like:</p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {chatExamples(kinds).map((q) => (
          <button key={q} onClick={() => void ask(q, [])} className="rounded-full border px-3 py-1 text-[13px] hover:bg-muted">
            {q}
          </button>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">Type @ to attach a note, todo{kinds.length ? ", ticket or pull request" : ""}.</p>
    </div>
  );
}

function Question({ message }: { message: ChatMessage }) {
  return (
    <div className="flex flex-col items-end gap-1" data-testid="chat-question">
      {message.sources.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1">
          {message.sources.map((s) => (
            <SourceChip key={s.key} source={s} />
          ))}
        </div>
      )}
      <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-[14px]">{message.text}</div>
    </div>
  );
}

function Answer({ message }: { message: ChatMessage }) {
  const cited = citedSources(message);
  return (
    <div data-testid="chat-answer" data-status={message.status ?? "done"}>
      {message.status === "searching" || (message.status === "writing" && !message.text) ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> {message.status === "searching" ? "Looking through your notes…" : "Reading what it found…"}
        </p>
      ) : (
        <AnswerText text={message.text} sources={message.sources} />
      )}
      {message.error && <p className="mt-1 text-sm text-destructive">{message.error}</p>}
      {!message.status && cited.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1" data-testid="chat-sources">
          {cited.map((s) => (
            <SourceChip key={s.key} source={s} number={message.sources.indexOf(s) + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Light markdown (paragraphs, lists, **bold**) with [n] citations as links to the sources. */
function AnswerText({ text, sources }: { text: string; sources: SourceRef[] }) {
  const blocks = useMemo(() => {
    const out: { list: boolean; lines: string[] }[] = [];
    for (const raw of text.trim().split("\n")) {
      const line = raw.trimEnd();
      if (!line.trim()) {
        out.push({ list: false, lines: [] });
        continue;
      }
      const item = line.match(/^\s*(?:[*-]|\d+\.)\s+(.*)/);
      const prev = out[out.length - 1];
      if (item) {
        if (prev?.list) prev.lines.push(item[1]);
        else out.push({ list: true, lines: [item[1]] });
      } else if (prev && !prev.list && prev.lines.length) prev.lines.push(line);
      else out.push({ list: false, lines: [line] });
    }
    return out.filter((b) => b.lines.length);
  }, [text]);
  return (
    <div className="space-y-2 text-[14px] leading-relaxed" data-testid="chat-answer-text">
      {blocks.map((b, i) =>
        b.list ? (
          <ul key={i} className="list-disc space-y-0.5 pl-5">
            {b.lines.map((l, j) => (
              <li key={j}>
                <Inline text={l} sources={sources} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={i}>
            <Inline text={b.lines.join("\n")} sources={sources} />
          </p>
        ),
      )}
    </div>
  );
}

function Inline({ text, sources }: { text: string; sources: SourceRef[] }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\[\d+(?:\s*,\s*\d+)*\])/g);
  return (
    <>
      {parts.map((p, i) => {
        const bold = p.match(/^\*\*([^*]+)\*\*$/);
        if (bold) return <strong key={i}>{bold[1]}</strong>;
        const cite = p.match(/^\[(\d+(?:\s*,\s*\d+)*)\]$/);
        if (cite) {
          return (
            <Fragment key={i}>
              {cite[1].split(",").map((n) => {
                const source = sources[Number(n.trim()) - 1];
                return source ? <Cite key={n} n={Number(n.trim())} source={source} /> : null;
              })}
            </Fragment>
          );
        }
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

function Cite({ n, source }: { n: number; source: SourceRef }) {
  return (
    <Tooltip content={source.title}>
      <button
        {...openProps(source)}
        className="mx-0.5 inline-flex h-4 min-w-4 -translate-y-px items-center justify-center rounded bg-primary/10 px-1 align-middle text-[10px] font-medium text-primary hover:bg-primary/20"
        data-testid="chat-cite"
      >
        {n}
      </button>
    </Tooltip>
  );
}

const ICONS = { note: FileText, todo: ListTodo, item: Puzzle };

function SourceChip({ source, number, onRemove }: { source: SourceRef; number?: number; onRemove?: () => void }) {
  const plugin = source.plugin ? enabledPlugins().find((p) => p.id === source.plugin) : undefined;
  const Icon = plugin?.icon ?? ICONS[source.kind];
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full border bg-background pl-2 pr-1 text-xs" data-testid="chat-source">
      <button {...openProps(source)} className="flex min-w-0 items-center gap-1 py-0.5 hover:text-primary" title={source.itemKind ?? source.kind}>
        {number !== undefined && <span className="tabular-nums text-muted-foreground">{number}</span>}
        <Icon className="size-3 shrink-0 text-muted-foreground" />
        <span className="truncate">{source.title}</span>
      </button>
      {onRemove ? (
        <button onClick={onRemove} className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Remove ${source.title}`}>
          <X className="size-3" />
        </button>
      ) : (
        <span className="w-1" />
      )}
    </span>
  );
}

/** Opens a note in a tab (middle-click too), a todo in its panel, a plugin item its own way. */
function openProps(source: SourceRef): { onClick: () => void; onMouseDown?: (e: React.MouseEvent) => void; onAuxClick?: (e: React.MouseEvent) => void } {
  if (source.kind === "note") return noteLinkProps(source.id);
  if (source.kind === "todo") return { onClick: () => useUI.getState().openTodo(source.id) };
  return {
    onClick: async () => {
      // After a restart the items aren't loaded yet.
      if (!pluginItem(source.key)) await buildDocs().catch(() => {});
      pluginItem(source.key)?.open();
    },
  };
}

// ---------------------------------------------------------------- the question box

function Composer({ busy }: { busy: boolean }) {
  const [text, setText] = useState("");
  const [attached, setAttached] = useState<SourceRef[]>([]);
  /** "@word" being typed: picker open with this filter. */
  const [mention, setMention] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);
  // Grow with the text, up to about 8 lines.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    // Scrollbars only once it's at its maximum height (a rounding difference showed them on one line).
    el.style.overflowY = el.scrollHeight > 200 ? "auto" : "hidden";
  }, [text]);

  const send = () => {
    if (busy || !text.trim()) return;
    void ask(text, attached);
    setText("");
    setAttached([]);
  };
  const onChange = (value: string) => {
    setText(value);
    const at = value.slice(0, input.current?.selectionStart ?? value.length).match(/(?:^|\s)@([^\s@]*)$/);
    setMention(at ? at[1] : null);
  };
  const pick = (s: SourceRef) => {
    setAttached((a) => (a.some((x) => x.key === s.key) ? a : [...a, s]));
    // Drop the "@word" that opened the picker.
    setText((t) => t.replace(/(^|\s)@[^\s@]*$/, "$1"));
    setMention(null);
    input.current?.focus();
  };

  return (
    <Popover open={mention !== null} onOpenChange={(o) => !o && setMention(null)}>
      <PopoverAnchor asChild>
        <div className="rounded-lg border bg-background p-2 shadow-sm focus-within:ring-1 focus-within:ring-ring" data-testid="chat-composer">
          {attached.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1" data-testid="chat-attached">
              {attached.map((s) => (
                <SourceChip key={s.key} source={s} onRemove={() => setAttached((a) => a.filter((x) => x.key !== s.key))} />
              ))}
            </div>
          )}
          <div className="flex items-end gap-1">
            <textarea
              ref={input}
              value={text}
              rows={1}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => {
                if (mention !== null && ["ArrowDown", "ArrowUp", "Enter", "Tab"].includes(e.key)) {
                  // The picker handles these (it listens on the window).
                  e.preventDefault();
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Ask about your notes… (@ to attach)"
              className="max-h-[200px] min-h-8 flex-1 resize-none overflow-x-hidden bg-transparent px-1.5 py-1 text-[14px] outline-none placeholder:text-muted-foreground"
              aria-label="Your question"
            />
            <Tooltip content="Attach a note, todo…">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  // Types the "@" (what follows filters the list).
                  setText((t) => (t && !/\s$/.test(t) ? `${t} @` : `${t}@`));
                  setMention("");
                  input.current?.focus();
                }}
                aria-label="Attach"
              >
                <AtSign />
              </Button>
            </Tooltip>
            {busy ? (
              <Tooltip content="Stop">
                <Button size="icon" variant="outline" onClick={stop} aria-label="Stop" data-testid="chat-stop">
                  <Square className="fill-current" />
                </Button>
              </Tooltip>
            ) : (
              <Button size="icon" onClick={send} disabled={!text.trim()} aria-label="Ask" data-testid="chat-send">
                <ArrowUp />
              </Button>
            )}
          </div>
        </div>
      </PopoverAnchor>
      <PopoverContent side="top" className="w-[min(420px,calc(100vw-32px))] p-1" onOpenAutoFocus={(e) => e.preventDefault()}>
        {mention !== null && <Picker filter={mention} onPick={pick} />}
      </PopoverContent>
    </Popover>
  );
}

/** Notes, open todos and plugins' items, filtered by what's typed after "@". */
function Picker({ filter, onPick }: { filter: string; onPick: (s: SourceRef) => void }) {
  const { data: notes = [] } = useNotes();
  const { data: todos = [] } = useTodos();
  const [items, setItems] = useState<SourceRef[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    let live = true;
    void Promise.all(
      enabledPlugins()
        .filter((p) => p.chat && p.id !== "chat")
        .map((p) => p.chat!.items().then((list) => list.map((i): SourceRef => ({ key: `${p.id}:${i.id}`, kind: "item", id: i.id, title: i.title, plugin: p.id, itemKind: p.chat!.kind })))),
    )
      .then((lists) => live && setItems(lists.flat()))
      .catch(() => {});
    // Also loads them for opening later.
    void buildDocs().catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const options = useMemo(() => {
    const q = filter.toLowerCase();
    const all: SourceRef[] = [
      ...[...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((n): SourceRef => ({ key: `note:${n.id}`, kind: "note", id: n.id, title: n.title })),
      ...todos.filter((t) => t.status !== "done" && !t.parentId).map((t): SourceRef => ({ key: `todo:${t.id}`, kind: "todo", id: t.id, title: t.title })),
      ...items,
    ];
    return all.filter((s) => !q || s.title.toLowerCase().includes(q)).slice(0, 8);
  }, [filter, notes, todos, items]);

  useEffect(() => setActive(0), [filter]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, options.length - 1));
      else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
      else if ((e.key === "Enter" || e.key === "Tab") && options[active]) onPick(options[active]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [options, active, onPick]);

  if (!options.length) return <p className="px-2 py-1.5 text-xs text-muted-foreground">Nothing matches “{filter}”.</p>;
  return (
    <div role="listbox" aria-label="Attach" data-testid="chat-picker">
      {options.map((s, i) => {
        const plugin = s.plugin ? enabledPlugins().find((p) => p.id === s.plugin) : undefined;
        const Icon = plugin?.icon ?? ICONS[s.kind];
        return (
          <button
            key={s.key}
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(s)}
            className={cn("flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px]", i === active && "bg-accent text-accent-foreground")}
          >
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{s.title}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">{s.itemKind ?? (s.kind === "note" ? "Note" : "Todo")}</span>
          </button>
        );
      })}
    </div>
  );
}
