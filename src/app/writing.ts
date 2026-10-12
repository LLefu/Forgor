import { useUI } from "./store";
import { useMeetingsStore } from "./meetings";

/** Writing tools are on and the language model (shared with meeting summaries) is downloaded. */
export function useWritingAvailable(): boolean {
  const enabled = useUI((s) => s.settings.writingEnabled);
  const model = useMeetingsStore((s) => s.models.find((m) => m.id === "summary")?.downloaded ?? false);
  return enabled && model;
}
