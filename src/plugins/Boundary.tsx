import { Component, type ReactNode } from "react";
import { showError } from "@/components/Toasts";

/**
 * Around everything a plugin renders: a plugin that throws shows a short
 * notice (and an error toast) instead of taking the app down.
 */
export class PluginBoundary extends Component<{ plugin: string; children: ReactNode; quiet?: boolean }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    showError(error, `Plugin "${this.props.plugin}"`);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.quiet) return null;
    return (
      <p className="m-2 rounded border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-xs text-destructive" data-testid="plugin-crashed">
        The plugin “{this.props.plugin}” ran into an error here.
      </p>
    );
  }
}
