import { useEffect, useState } from "react";
import { AlertTriangle, Mic, Volume2 } from "lucide-react";
import { meetings, type Levels } from "@/platform/meetings";
import { cn } from "@/lib/utils";
import { meterWidth, recordingWarnings } from "@/lib/recording";

/** Polls the live levels while `recording`. */
function useLevels(recording: boolean): Levels | null {
  const [levels, setLevels] = useState<Levels | null>(null);
  useEffect(() => {
    if (!recording) {
      setLevels(null);
      return;
    }
    let stop = false;
    const tick = async () => {
      const l = await meetings().levels().catch(() => null);
      if (!stop) setLevels(l);
    };
    void tick();
    const t = setInterval(tick, 150);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [recording]);
  return levels;
}

/** Level meters for the mic and the computer's sound, plus warnings. */
export function RecordingStatus({ recording, className }: { recording: boolean; className?: string }) {
  const levels = useLevels(recording);
  if (!recording || !levels) return null;
  const warnings = recordingWarnings(levels);
  return (
    <div className={cn("space-y-1.5", className)} data-testid="recording-status">
      <Meter icon={Mic} label="You (microphone)" rms={levels.micSignal ? levels.mic : 0} testId="meter-mic" />
      {levels.systemAudio && <Meter icon={Volume2} label="Computer sound" rms={levels.system} testId="meter-system" />}
      {warnings.map((w) => (
        <p
          key={w.text}
          role="alert"
          className={cn("flex items-start gap-1.5 rounded px-2 py-1.5 text-xs", w.kind === "error" ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-700 dark:text-amber-400")}
          data-testid="recording-warning"
        >
          <AlertTriangle className="mt-px size-3.5 shrink-0" /> {w.text}
        </p>
      ))}
    </div>
  );
}

function Meter({ icon: Icon, label, rms, testId }: { icon: React.ComponentType<{ className?: string }>; label: string; rms: number; testId: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid={testId}>
      <Icon className="size-3.5 shrink-0" />
      <span className="w-32 shrink-0 truncate">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-success transition-[width] duration-100" style={{ width: `${meterWidth(rms)}%` }} />
      </div>
    </div>
  );
}
