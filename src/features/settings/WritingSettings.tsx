import { useEffect } from "react";
import { Row } from "./Row";
import { Switch } from "@/components/ui/switch";
import { useUI } from "@/app/store";
import { refreshModels, useMeetingsStore } from "@/app/meetings";
import { ModelRow } from "@/features/meetings/MeetingsSettings";

/** Settings → Writing tools: the toggle, and the language model it needs (the same one meeting summaries use). */
export function WritingSettings({ desktop }: { desktop: boolean }) {
  const enabled = useUI((s) => s.settings.writingEnabled);
  const update = useUI((s) => s.updateSetting);
  const model = useMeetingsStore((s) => s.models.find((m) => m.id === "summary"));

  useEffect(() => {
    if (enabled) void refreshModels();
  }, [enabled]);

  return (
    <Row
      label="Writing tools"
      hint={`Select text (or use the AI button above a note) and tell the AI what to do: rewrite, shorten, translate, turn into a list… It runs on this computer; you review every change before it's applied.${desktop ? "" : " (The browser build uses a demo reply.)"}`}
    >
      <div className="flex items-center gap-2">
        <Switch checked={enabled} onCheckedChange={(v) => void update("writingEnabled", v)} aria-label="Writing tools" data-testid="writing-toggle" />
        <span className="text-sm">{enabled ? "On" : "Off"}</span>
      </div>
      {enabled && model && (
        <div className="mt-4 space-y-2" data-testid="writing-model">
          <ModelRow model={model} />
          <p className="text-xs text-muted-foreground">
            {model.downloaded
              ? "The same model makes the meeting summaries, so it's stored only once."
              : "Download the language model to use the writing tools. Meeting summaries use the same model."}
          </p>
        </div>
      )}
    </Row>
  );
}
