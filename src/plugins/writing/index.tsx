import { Sparkles } from "lucide-react";
import { useModelReady } from "@/app/models";
import { writer } from "@/platform/writing";
import type { NoteHeaderProps, Plugin } from "../types";
import { AskAIButton } from "./AskAIButton";

/** AI writing tools in the editor, on the local language model. */
export const writingPlugin: Plugin = {
  id: "writing",
  name: "Writing tools",
  description: "Select text (or use the AI button above a note) and tell the AI what to do: rewrite, shorten, translate, turn into a list… It runs on this computer; you review every change before it's applied.",
  version: "1.0.0",
  author: "Forgor",
  icon: Sparkles,
  builtIn: true,
  models: [{ id: "language", for: "writing and rewriting text" }],
  useWriter: () => (useModelReady("language") ? writer() : null),
  noteHeader: { actions: AskAI },
};

function AskAI({ editor }: NoteHeaderProps) {
  return useModelReady("language") ? <AskAIButton hasSelection={editor.hasSelection} onRun={editor.runAI} /> : null;
}
