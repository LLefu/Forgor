import { Component, type ReactNode } from "react";
import { showError } from "@/components/Toasts";
import { reportPluginFault } from "./host";

/**
 * Around everything a plugin renders: a plugin that throws shows a short
 * notice instead of taking the app down. A community plugin (`id` given) is
 * also switched off and labelled at once (registry.tsx); a built-in one only
 * shows the error. `fallback` is what stands in for it (default: a notice,
 * or nothing when `quiet`).
 */
export class PluginBoundary extends Component<{ plugin: string; id?: string; children: ReactNode; quiet?: boolean; fallback?: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    if (this.props.id) reportPluginFault(this.props.id, error, "what it shows");
    else showError(error, `Plugin "${this.props.plugin}"`);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    if (this.props.quiet) return null;
    return (
      <p className="m-2 rounded border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-xs text-destructive" data-testid="plugin-crashed">
        The plugin “{this.props.plugin}” ran into an error here.
      </p>
    );
  }
}
