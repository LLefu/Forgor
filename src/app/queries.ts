import { QueryClient, useQuery } from "@tanstack/react-query";
import { onDataChange } from "@/data/context";
import * as notes from "@/data/notes";
import * as todos from "@/data/todos";
import * as history from "@/data/history";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: false },
  },
});

/** First parts of query keys that are remote (plugins add theirs, see plugins/types.ts `remoteQueries`). */
const remoteQueries = new Set<string>();
export function addRemoteQueries(roots: string[]) {
  roots.forEach((r) => remoteQueries.add(r));
}

// All data is local and cheap to query, so any mutation simply refreshes
// every active query. Bursts of change events are coalesced per frame.
let pending = false;
onDataChange(() => {
  if (pending) return;
  pending = true;
  queueMicrotask(() => {
    pending = false;
    // Not the storage overview (it walks the whole notes folder) or remote data (e.g. Jira; it refreshes on its own schedule).
    void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "storage" && !remoteQueries.has(String(q.queryKey[0])) });
  });
});

export const useTodos = () => useQuery({ queryKey: ["todos"], queryFn: todos.listTodos });
export const useTodo = (id: string | null) =>
  useQuery({ queryKey: ["todo", id], queryFn: () => (id ? todos.getTodo(id) : null), enabled: !!id });
export const useSubtasks = (id: string) => useQuery({ queryKey: ["subtasks", id], queryFn: () => todos.listSubtasks(id) });
export const useNotesForTodo = (id: string) => useQuery({ queryKey: ["notesForTodo", id], queryFn: () => todos.notesForTodo(id) });
export const useTodosForNote = (id: string) => useQuery({ queryKey: ["todosForNote", id], queryFn: () => todos.todosForNote(id) });

export const useFolders = () => useQuery({ queryKey: ["folders"], queryFn: notes.listFolders });
export const useNotes = () => useQuery({ queryKey: ["notes"], queryFn: notes.listNotes });
export const useNoteMeta = (id: string) => useQuery({ queryKey: ["noteMeta", id], queryFn: () => notes.getNoteMeta(id) });
export const useBacklinks = (id: string) => useQuery({ queryKey: ["backlinks", id], queryFn: () => notes.backlinks(id) });

export const useAttachments = (folderPath: string) => useQuery({ queryKey: ["attachments", folderPath], queryFn: () => notes.listAttachments(folderPath) });

export const useTrash = () => useQuery({ queryKey: ["trash"], queryFn: history.listTrash });
export const useVersions = (noteId: string) => useQuery({ queryKey: ["versions", noteId], queryFn: () => history.listVersions(noteId) });

