/**
 * Inline todos: GFM task-list lines inside a note become real todos.
 * The link is kept by a marker at the end of the line:
 *
 *   - [ ] Call Jan ^t-k3j9x0a1b2c4
 *
 * The file stays valid markdown, and the marker is hidden in the editor.
 */

export interface InlineTask {
  lineIndex: number;
  checked: boolean;
  text: string;
  todoId: string | null;
}

const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)( |x|X)(\]\s+)(.*?)\s*$/;
const MARKER_RE = /\s*\^t-([a-z0-9]+)$/;
const FENCE_RE = /^\s*(```|~~~)/;

function eachTaskLine(lines: string[], fn: (i: number, m: RegExpExecArray) => void) {
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE_RE.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = TASK_RE.exec(lines[i]);
    if (m) fn(i, m);
  }
}

export function parseTasks(md: string): InlineTask[] {
  const lines = md.split("\n");
  const out: InlineTask[] = [];
  eachTaskLine(lines, (i, m) => {
    const rest = m[4];
    const mk = MARKER_RE.exec(rest);
    const text = (mk ? rest.slice(0, mk.index) : rest).trim();
    if (!text) return;
    out.push({ lineIndex: i, checked: m[2] !== " ", text, todoId: mk ? mk[1] : null });
  });
  return out;
}

/** Adds markers to task lines that don't have one yet. `makeId` is called per new task. */
export function assignTaskIds(md: string, makeId: (text: string, checked: boolean) => string): { md: string; created: { id: string; text: string; checked: boolean }[] } {
  const lines = md.split("\n");
  const created: { id: string; text: string; checked: boolean }[] = [];
  eachTaskLine(lines, (i, m) => {
    const rest = m[4];
    if (MARKER_RE.test(rest) || !rest.trim()) return;
    const checked = m[2] !== " ";
    const id = makeId(rest.trim(), checked);
    created.push({ id, text: rest.trim(), checked });
    lines[i] = `${m[1]}${m[2]}${m[3]}${rest} ^t-${id}`;
  });
  return { md: lines.join("\n"), created };
}

/** Flip the checkbox of the task with the given todo id. Returns null if not found or unchanged. */
export function setTaskChecked(md: string, todoId: string, checked: boolean): string | null {
  const lines = md.split("\n");
  let changed = false;
  eachTaskLine(lines, (i, m) => {
    const mk = MARKER_RE.exec(m[4]);
    if (!mk || mk[1] !== todoId) return;
    const wasChecked = m[2] !== " ";
    if (wasChecked === checked) return;
    lines[i] = `${m[1]}${checked ? "x" : " "}${m[3]}${m[4]}`;
    changed = true;
  });
  return changed ? lines.join("\n") : null;
}

/** Replace the text of the task with the given todo id. Returns null if not found or unchanged. */
export function setTaskText(md: string, todoId: string, text: string): string | null {
  const lines = md.split("\n");
  let changed = false;
  eachTaskLine(lines, (i, m) => {
    const mk = MARKER_RE.exec(m[4]);
    if (!mk || mk[1] !== todoId) return;
    const current = m[4].slice(0, mk.index).trim();
    if (current === text.trim()) return;
    lines[i] = `${m[1]}${m[2]}${m[3]}${text.trim()} ^t-${todoId}`;
    changed = true;
  });
  return changed ? lines.join("\n") : null;
}

/** Matches the marker in rendered text (used by the editor decoration). */
export const INLINE_MARKER_GLOBAL = /\s?\^t-[a-z0-9]+/g;
