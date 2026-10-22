import { useEffect } from "react";
import { useUI } from "./store";
import { Sidebar } from "./Sidebar";
import { installPluginErrorListeners } from "@/plugins/listeners";
import { useShortcuts } from "@/features/shortcuts/all";
import { ShortcutsHelp } from "@/features/shortcuts/ShortcutsHelp";
import { TodayPage } from "@/features/today/TodayPage";
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
import { SearchView } from "@/features/search/SearchView";
import { TrashView } from "@/features/history/TrashView";
import { SettingsView } from "@/features/settings/SettingsView";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Platform } from "@/platform/types";
import { applyHotkey, listenForPopupRequests } from "./hotkey";
import { emitChange } from "@/data/context";
import { syncVault } from "@/data/notes";
import { openExternal } from "@/platform/os";
import { startUpdateChecks } from "./updates";
import { ConfirmDialogHost } from "@/components/ConfirmDialog";
import { ToastHost } from "@/components/Toasts";
import { ZoomIndicator } from "./zoom";
import { startModels } from "./models";
import { PluginRuntime } from "@/plugins/registry";
import { startStoreChecks } from "@/plugins/store";
import { PluginPageView, PluginPanelView } from "@/plugins/views";
import { PluginsPage } from "@/features/plugins/PluginsPage";
import { PluginInfoPanel } from "@/features/plugins/PluginInfoPanel";

export function Shell({ platform }: { platform: Platform }) {
  const setView = useUI((s) => s.setView);
  const openTodo = useUI((s) => s.openTodo);
  const goBack = useUI((s) => s.goBack);
  const hotkey = useUI((s) => s.settings.hotkey);
  const sidebarHidden = useUI((s) => s.settings.sidebarHidden);

  // Keyboard shortcuts (the app's and plugins'; Settings → Shortcuts)
  useShortcuts();

  // Mouse side buttons (button 3 = back, 4 = forward), like in a browser.
  useEffect(() => {
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
    return () => {
      window.removeEventListener("mousedown", onMouse);
      window.removeEventListener("mouseup", onMouse);
      window.removeEventListener("auxclick", onMouse);
    };
  }, [goBack]);

  // External links clicked in the editor
  useEffect(() => {
    const onOpen = (e: Event) => void openExternal((e as CustomEvent<string>).detail);
    window.addEventListener("open-external", onOpen);
    return () => window.removeEventListener("open-external", onOpen);
  }, []);

  // Desktop: look for updates in the background (installing is always manual)
  useEffect(() => startUpdateChecks(), []);

  // Errors nobody catches in a plugin's code switch that plugin off
  useEffect(() => installPluginErrorListeners(), []);

  // Plugin store: updates and plugins taken out of the store (shortly after start, then every 6 hours)
  useEffect(() => startStoreChecks(), []);

  // AI models: download progress (shared by meetings, writing tools…)
  useEffect(() => startModels(), []);

  // Desktop: global shortcut + requests from the popup window
  useEffect(() => {
    if (platform.kind !== "tauri") return;
    applyHotkey(hotkey).catch((err) => console.warn("Could not register global shortcut", err));
    return listenForPopupRequests({
      openNote: (id) => setView({ kind: "note", id }),
      openTodo: (id) => openTodo(id),
      dataChanged: () => {
        void syncVault();
        emitChange("todos", "notes", "folders");
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform.kind]);

  return (
    <TooltipProvider>
      <div className="flex h-full">
        {!sidebarHidden && <Sidebar />}
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
      <ShortcutsHelp />
      <ConfirmDialogHost />
      <AddColorDialogHost />
      <AttachmentPickerHost />
      <ToastHost />
      <ZoomIndicator />
      {/* Enabled plugins: their startup work and dialogs */}
      <PluginRuntime />
    </TooltipProvider>
  );
}

function MainView({ platform }: { platform: Platform }) {
  const view = useUI((s) => s.view);
  if (!view) return <NothingOpen />;
  switch (view.kind) {
    case "today":
      return <TodayPage />;
    case "all":
      return <AllTasks />;
    case "plugins":
      return <PluginsPage />;
    case "plugin":
      return <PluginPageView key={`${view.plugin}/${view.page}/${view.param ?? ""}`} view={view} />;
    case "search":
      return <SearchView />;
    case "trash":
      return <TrashView />;
    case "settings":
      return <SettingsView platform={platform} />;
    case "note":
      return <NoteView key={view.id} id={view.id} />;
  }
}

/** Todo details, a plugin's info, a plugin's own panel (e.g. a Jira ticket), or the open folder. */
function RightPanel() {
  const todoId = useUI((s) => s.selectedTodoId);
  const folderId = useUI((s) => s.selectedFolderId);
  const pluginId = useUI((s) => s.selectedPluginId);
  const pluginPanel = useUI((s) => !!s.pluginPanel);
  if (todoId) return <TodoDetail />;
  if (pluginId) return <PluginInfoPanel key={pluginId} id={pluginId} />;
  if (pluginPanel) return <PluginPanelView />;
  if (folderId) return <FolderPanel id={folderId} />;
  return null;
}
