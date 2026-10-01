import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { applySpeakerNames, useMeetingsStore } from "@/app/meetings";
import { getMeeting, knownSpeakerNames } from "@/data/meetings";
import { formatDuration, speakersOf, type SpeakerNames } from "@/lib/meetingNote";
import { showError } from "@/components/Toasts";
import { RECOGNIZE } from "@/lib/voices";

/**
 * Name the voices speaker separation found ("Spreker 2" → "Jeroen"). Giving
 * two numbers the same name merges them (one person split in two). The
 * transcript and summary are rebuilt with the names.
 */
export function SpeakersDialogHost() {
  const id = useMeetingsStore((s) => s.speakersOf);
  const close = () => useMeetingsStore.getState().setSpeakersOf(null);
  const { data: meeting } = useQuery({ queryKey: ["meeting", id], queryFn: () => (id ? getMeeting(id) : null), enabled: !!id });
  const { data: known = [] } = useQuery({ queryKey: ["speaker-names"], queryFn: knownSpeakerNames, enabled: !!id });
  const [names, setNames] = useState<SpeakerNames>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (meeting) setNames(meeting.speakers);
  }, [meeting]);

  const speakers = meeting?.result ? speakersOf(meeting.result.segments) : [];
  const label = meeting?.result?.language === "en" ? "Speaker" : "Spreker";

  const save = async () => {
    if (!meeting) return;
    setBusy(true);
    try {
      await applySpeakerNames(meeting, names);
      close();
    } catch (e) {
      showError(e, "Could not name the speakers");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!id} onOpenChange={(open) => !open && !busy && close()}>
      <DialogContent title="Who is who?" className="w-[560px]" data-testid="speakers-dialog">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <p className="mb-3 text-xs text-muted-foreground">
            Forgor told {speakers.length} voices apart. Give them a name; the same name for two numbers merges them. The separation isn't perfect, so check a quote or two.
            Named voices are recognized in your next meetings (the voice fingerprints stay on this computer; manage them in Settings).
          </p>
          <datalist id="speaker-name-suggestions">
            {known.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
            {speakers.map((s) => (
              <div key={s.id} className="rounded border p-2.5" data-testid="speaker-row">
                <div className="flex items-center gap-2">
                  <span className="w-24 shrink-0 text-sm font-medium">
                    {label} {s.id}
                  </span>
                  <Input
                    value={names[s.id] ?? ""}
                    onChange={(e) => setNames((n) => ({ ...n, [s.id]: e.target.value }))}
                    placeholder="Name"
                    list="speaker-name-suggestions"
                    aria-label={`Name for ${label} ${s.id}`}
                    className="h-7"
                  />
                  <Recognition match={meeting?.result?.recognized?.[s.id]} current={names[s.id]} onUse={(name) => setNames((n) => ({ ...n, [s.id]: name }))} />
                  <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">{formatDuration(s.seconds)}</span>
                </div>
                {s.quotes.map((q, i) => (
                  <p key={i} className="mt-1.5 line-clamp-2 text-xs italic text-muted-foreground">
                    “{q}”
                  </p>
                ))}
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-end gap-2">
            {busy && (
              <span className="mr-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Updating the summary with the names…
              </span>
            )}
            <Button variant="ghost" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy} data-testid="save-speakers">
              Save names
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Recognized" when the name came from an earlier meeting; a one-click suggestion when it's a near match. */
function Recognition({ match, current, onUse }: { match?: { name: string; similarity: number }; current?: string; onUse: (name: string) => void }) {
  if (!match) return null;
  const pct = `${Math.round(match.similarity * 100)}%`;
  if (match.similarity >= RECOGNIZE && current?.trim() === match.name) {
    return (
      <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[11px] text-accent-foreground" title={`Sounds like ${match.name} from earlier meetings (${pct} alike)`}>
        Recognized
      </span>
    );
  }
  if (current?.trim()) return null;
  return (
    <button
      type="button"
      onClick={() => onUse(match.name)}
      className="shrink-0 rounded border border-dashed px-1.5 py-0.5 text-[11px] text-muted-foreground hover:border-solid hover:text-foreground"
      title={`Sounds a bit like ${match.name} (${pct} alike)`}
      data-testid="voice-suggestion"
    >
      {match.name}?
    </button>
  );
}
