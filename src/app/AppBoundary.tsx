import { Component, type ErrorInfo, type ReactNode } from "react";
import { useUI } from "./store";
import { requestSafeMode } from "./startup";
import { errorMessage, pluginIdFromStack } from "@/plugins/faults";
import { reportPluginFault } from "@/plugins/host";
import { getPlugin } from "@/plugins/registry";

/**
 * The last resort around the whole app: whatever crashes without a closer
 * boundary ends up here instead of in a white screen. If the stack says a
 * community plugin did it, that plugin is switched off (it gets its label) and
 * the app draws again; otherwise a screen says what happened and offers a
 * reload, or a reload without community plugins.
 */
export class AppBoundary extends Component<{ children: ReactNode }, { error: unknown; attempt: number }> {
  state = { error: null as unknown, attempt: 0 };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Forgor crashed", error, info.componentStack);
    const id = pluginIdFromStack((error as Error | undefined)?.stack);
    const plugin = id ? getPlugin(id) : undefined;
    // Only a plugin that is still on can be the one to switch off (else the same crash would loop), and not forever.
    if (id && plugin && !plugin.builtIn && useUI.getState().settings.plugins[id] === true && this.state.attempt < 3) {
      reportPluginFault(id, error, "what it shows in the app");
      this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));
    }
  }

  render() {
    if (this.state.error === null) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center" data-testid="app-crashed">
        <h1 className="text-base font-semibold">Something went wrong</h1>
        <p className="max-w-md text-sm text-muted-foreground">{errorMessage(this.state.error)}</p>
        <div className="mt-2 flex gap-2">
          <button className="rounded border px-3 py-1.5 text-sm hover:bg-muted" onClick={() => location.reload()}>
            Reload
          </button>
          <button
            className="rounded border px-3 py-1.5 text-sm hover:bg-muted"
            onClick={() => {
              requestSafeMode();
              location.reload();
            }}
            data-testid="app-crashed-safe"
          >
            Reload without community plugins
          </button>
        </div>
      </div>
    );
  }
}
