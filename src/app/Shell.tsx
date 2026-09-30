import { useEffect } from "react";
import { useUI } from "./store";
import { Sidebar } from "./Sidebar";
import { TodosPage } from "@/features/todos/TodosPage";
import { AllTasks } from "@/features/todos/AllTasks";
import { TodoDetail } from "@/features/todos/TodoDetail";
import { QuickAddDialog } from "@/features/todos/QuickAdd";
import { NoteView } from "@/features/editor/NoteView";
import { FolderPanel } from "@/features/folder/FolderPanel";
import { TabBar } from "./TabBar";
import { NothingOpen } from "./NothingOpen";
import { SearchOverlay } from "@/features/search/SearchOverlay";
import { AddColorDialogHost } from "@/components/ColorPicker";
import { AttachmentPickerHost } from "@/components/AttachmentPicker";
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
import { ZoomIndicator } from "./zoom";

export function Shell({ platform }: { platform: Platform }) {
  const setView = useUI((s) => s.setView);
  const openQuickAdd = useUI((s) => s.openQuickAdd);
  const openTodo = useUI((s) => s.openTodo);
  const goBack = useUI((s) => s.goBack);
  const hotkey = useUI((s) => s.settings.hotkey);

  // App-wide keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matches(e, "Mod+Shift+F")) {
        e.preventDefault();
        useUI.getState().setSearchOverlay(true);
      } else if (matches(e, "Mod+F")) {
        e.preventDefault();
        // In a note: find in that note. Elsewhere: search everything.
        if (useUI.getState().view?.kind === "note") window.dispatchEvent(new Event("find-in-note"));
        else useUI.getState().setSearchOverlay(true);
      } else if (matches(e, "Mod+W")) {
        e.preventDefault();
        const ui = useUI.getState();
        if (ui.activeTab) ui.closeTab(ui.activeTab);
      } else if (matches(e, "Mod+Tab") || matches(e, "Mod+Shift+Tab")) {
        e.preventDefault();
        const ui = useUI.getState();
        if (!ui.tabs.length) return;
        const i = ui.tabs.findIndex((t) => t.id === ui.activeTab);
        const next = ui.tabs[(i + (e.shiftKey ? -1 : 1) + ui.tabs.length) % ui.tabs.length];
        ui.activateTab(next.id);
      } else if (e.key === "Escape" && !e.defaultPrevented && !(e.target as HTMLElement).closest("input, textarea, [role=dialog], [role=menu]")) {
        // Close the right-hand panel: the todo first (it sits on top of a folder), then the folder.
        useUI.getState().closePanel();
      } else if (matches(e, "Mod+K")) {
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
        <div className="flex min-w-0 flex-1 flex-col">
          <TabBar />
          <main className="min-h-0 flex-1 overflow-y-auto" data-testid="main">
            <MainView platform={platform} />
          </main>
        </div>
        <RightPanel />
      </div>
      <QuickAddDialog />
      <SearchOverlay />
      <ConfirmDialogHost />
      <AddColorDialogHost />
      <AttachmentPickerHost />
      <ToastHost />
      <ZoomIndicator />
    </TooltipProvider>
  );
}

function MainView({ platform }: { platform: Platform }) {
  const view = useUI((s) => s.view);
  if (!view) return <NothingOpen />;
  switch (view.kind) {
    case "inbox":
    case "today":
      return <TodosPage kind={view.kind} />;
    case "all":
      return <AllTasks />;
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
      return <NoteView key={view.id} id={view.id} />;
  }
}

/** Todo details, or (underneath) the open folder. */
function RightPanel() {
  const todoId = useUI((s) => s.selectedTodoId);
  const folderId = useUI((s) => s.selectedFolderId);
  if (todoId) return <TodoDetail />;
  if (folderId) return <FolderPanel id={folderId} />;
  return null;
}
