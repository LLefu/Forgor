import { useEffect, useState } from "react";
import { Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { startRecording, stopRecording, useMeetingsStore, useRecordingAvailable } from "@/app/meetings";
import { formatTimestamp } from "@/lib/meetingNote";
import { cn } from "@/lib/utils";

/** Seconds since `startedAt`, updating every second (null when not recording). */
export function useElapsed(startedAt: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  return startedAt === null ? null : Math.max(0, (now - startedAt) / 1000);
}

/** "Start recording", or a red "Stop · 12:34" while recording. */
export function RecordButton({ className }: { className?: string }) {
  const current = useMeetingsStore((s) => s.current);
  const available = useRecordingAvailable();
  const elapsed = useElapsed(current?.startedAt ?? null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  if (current) {
    return (
      <Button variant="destructive" className={className} disabled={busy} onClick={() => run(stopRecording)} data-testid="stop-recording">
        <Square className="fill-current" /> Stop · <span className="tabular-nums">{formatTimestamp(elapsed ?? 0)}</span>
      </Button>
    );
  }
  return (
    <Button className={cn(className)} disabled={busy || !available} onClick={() => run(startRecording)} data-testid="start-recording">
      <Mic /> Start recording
    </Button>
  );
}
