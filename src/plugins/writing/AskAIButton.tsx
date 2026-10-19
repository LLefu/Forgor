import { useState } from "react";
import { ArrowUp, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Writing tools from the note's top bar: a prompt for the selection, or the
 * whole note when nothing is selected. The reply shows in the note as a diff.
 */
export function AskAIButton({ hasSelection, onRun }: { hasSelection: () => boolean; onRun: (instruction: string) => void }) {
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState(false);
  const [instruction, setInstruction] = useState("");

  const submit = () => {
    if (!instruction.trim()) return;
    setOpen(false);
    onRun(instruction.trim());
    setInstruction("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (o) setSelection(hasSelection());
        setOpen(o);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Ask AI" title="Ask AI" data-testid="note-ask-ai">
          <Sparkles /> AI
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-2" onCloseAutoFocus={(e) => e.preventDefault()}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Textarea
            autoFocus
            rows={3}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={selection ? "What should AI do with the selection?" : "What should AI do with this note? E.g. fix spelling, make it a list…"}
            className="resize-none"
            aria-label="Instruction"
            data-testid="ask-ai-input"
          />
          <div className="mt-2 flex items-center gap-2">
            <span className="flex-1 text-xs text-muted-foreground">
              Applies to {selection ? "the selection" : "the whole note"}. Runs on this computer; you review the result first.
            </span>
            <Button type="submit" size="sm" disabled={!instruction.trim()} aria-label="Send">
              <ArrowUp />
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
