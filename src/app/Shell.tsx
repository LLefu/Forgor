import { useEffect } from "react";
import { useUI } from "./store";
import { Sidebar } from "./Sidebar";
import { TodosPage } from "@/features/todos/TodosPage";
import { TodoDetail } from "@/features/todos/TodoDetail";
import { QuickAddDialog } from "@/features/todos/QuickAdd";
import { NoteView } from "@/features/editor/NoteView";
import { FolderView } from "@/features/folder/FolderView";
import { CalendarView } from "@/features/calendar/CalendarView";
import { SearchView } from "@/features/search/SearchView";
import { TrashView, ArchiveView } from "@/features/history/TrashView";
import { SettingsView } from "@/features/settings/SettingsView";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Platform } from "@/platform/types";
import { matches } from "@/lib/keys";
import { applyHotkey, listenForPopupRequests } from "./hotkey";
import { emitChange } from "@/data/context";
import { syncVault } from "@/data/notes";
import { openExternal } from "@/platform/os";
import { startUpdateChecks } from "./updates";
import { ConfirmDialogHost } from "@/components/ConfirmDialog";
import { ToastHost } from "@/components/Toasts";

export function Shell({ platform }: { platform: Platform }) {
  const setView = useUI((s) => s.setView);
  const openQuickAdd = useUI((s) => s.openQuickAdd);
  const openTodo = useUI((s) => s.openTodo);
  const goBack = useUI((s) => s.goBack);
  const hotkey = useUI((s) => s.settings.hotkey);

  // App-wide keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matches(e, "Mod+K")) {
        e.preventDefault();
        setView({ kind: "search" });
        setTimeout(() => window.dispatchEvent(new Event("focus-search")), 0);
      } else if (matches(e, "Mod+Shift+A")) {
        e.preventDefault();
        openQuickAdd();
      } else if (matches(e, "Alt+ArrowLeft")) {
        e.preventDefault();
        goBack();
      } else if (matches(e, "Alt+ArrowRight")) {
        e.preventDefault();
        useUI.getState().goForward();
      }
    };
    // Mouse side buttons (button 3 = back, 4 = forward), like in a browser.
    const onMouse = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      if (e.type === "mouseup") {
        if (e.button === 3) goBack();
        else useUI.getState().goForward();
      }
    };
    window.addEventListener("mousedown", onMouse);
    window.addEventListener("mouseup", onMouse);
    window.addEventListener("auxclick", onMouse);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onMouse);
      window.removeEventListener("mouseup", onMouse);
      window.removeEventListener("auxclick", onMouse);
    };
  }, [setView, openQuickAdd, goBack]);

  // External links clicked in the editor
  useEffect(() => {
    const onOpen = (e: Event) => void openExternal((e as CustomEvent<string>).detail);
    window.addEventListener("open-external", onOpen);
    return () => window.removeEventListener("open-external", onOpen);
  }, []);

  // Desktop: look for updates in the background (installing is always manual)
  useEffect(() => startUpdateChecks(), []);

  // Desktop: global shortcut + requests from the popup window
  useEffect(() => {
    if (platform.kind !== "tauri") return;
    applyHotkey(hotkey).catch((err) => console.warn("Could not register global shortcut", err));
    let off = () => {};
    void listenForPopupRequests({
      openNote: (id) => setView({ kind: "note", id }),
      openTodo: (id) => openTodo(id),
      dataChanged: () => {
        void syncVault();
        emitChange("todos", "notes", "folders");
      },
    }).then((o) => (off = o));
    return () => off();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform.kind]);

  return (
    <TooltipProvider>
      <div className="flex h-full">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-y-auto" data-testid="main">
          <MainView platform={platform} />
        </main>
        <TodoDetail />
      </div>
      <QuickAddDialog />
      <ConfirmDialogHost />
      <ToastHost />
    </TooltipProvider>
  );
}

function MainView({ platform }: { platform: Platform }) {
  const view = useUI((s) => s.view);
  switch (view.kind) {
    case "inbox":
    case "today":
    case "upcoming":
      return <TodosPage kind={view.kind} />;
    case "calendar":
      return <CalendarView />;
    case "search":
      return <SearchView />;
    case "archive":
      return <ArchiveView />;
    case "trash":
      return <TrashView />;
    case "settings":
      return <SettingsView platform={platform} />;
    case "note":
      return <NoteView id={view.id} />;
    case "folder":
      return <FolderView id={view.id} />;
  }
}
