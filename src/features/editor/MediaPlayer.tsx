import { useEffect, useRef, useState } from "react";
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

const SPEEDS = [1, 1.25, 1.5, 2, 0.75];
export const MIN_VIDEO_WIDTH = 200;

function fmt(t: number) {
  if (!Number.isFinite(t) || t < 0) return "0:00";
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Video/audio player in the app's style (the native controls look different on
 * every OS). Videos can be resized with the corner handle; the width is saved
 * with the link (`onResize`).
 */
export function MediaPlayer({
  kind,
  src,
  name,
  width,
  onResize,
  onOpenExternal,
}: {
  kind: "video" | "audio";
  src: string;
  name: string;
  width: number | null;
  onResize: (width: number) => void;
  onOpenExternal: () => void;
}) {
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [failed, setFailed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [w, setW] = useState<number | null>(width);
  useEffect(() => setW(width), [width]);

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === box.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const toggle = () => {
    const m = media.current;
    if (!m) return;
    if (m.paused) void m.play().catch(() => setFailed(true));
    else m.pause();
  };
  const setRate = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (media.current) media.current.playbackRate = next;
  };
  const toggleMute = () => {
    const m = media.current;
    if (!m) return;
    m.muted = !m.muted;
    setMuted(m.muted);
  };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void box.current?.requestFullscreen?.().catch(() => {});
  };

  // Drag the corner handle to resize (videos only).
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = box.current!.getBoundingClientRect().width;
    const maxW = box.current!.parentElement?.getBoundingClientRect().width ?? 2000;
    let last = startW;
    const move = (ev: PointerEvent) => {
      last = Math.round(Math.max(MIN_VIDEO_WIDTH, Math.min(maxW, startW + ev.clientX - startX)));
      setW(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("resizing-media");
      onResize(last);
    };
    document.body.classList.add("resizing-media");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const events = {
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
    onTimeUpdate: () => setTime(media.current?.currentTime ?? 0),
    onLoadedMetadata: () => setDuration(media.current?.duration ?? 0),
    onDurationChange: () => setDuration(media.current?.duration ?? 0),
    onError: () => setFailed(true),
    onVolumeChange: () => {
      setVolume(media.current?.volume ?? 1);
      setMuted(media.current?.muted ?? false);
    },
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const m = media.current;
    if (!m) return;
    if (e.key === " " || e.key === "k") toggle();
    else if (e.key === "ArrowRight") m.currentTime = Math.min(m.duration || 0, m.currentTime + 5);
    else if (e.key === "ArrowLeft") m.currentTime = Math.max(0, m.currentTime - 5);
    else if (e.key === "m") toggleMute();
    else if (e.key === "f" && kind === "video") toggleFullscreen();
    else return;
    e.preventDefault();
  };

  if (failed) {
    return (
      <div className="flex max-w-[480px] items-center gap-3 rounded border bg-muted/40 px-3 py-2 text-[13px]" data-testid="media-failed">
        <span className="min-w-0 flex-1 truncate text-muted-foreground">Can’t play “{name}” here.</span>
        <button onClick={onOpenExternal} className="flex shrink-0 items-center gap-1 text-primary hover:underline">
          <ExternalLink className="size-3.5" /> Open
        </button>
      </div>
    );
  }

  const controls = (
    <div className="flex items-center gap-2 px-3 pb-2 pt-6 text-white">
      <IconButton label={playing ? "Pause" : "Play"} onClick={toggle}>
        {playing ? <Pause className="size-4" fill="currentColor" /> : <Play className="size-4 translate-x-px" fill="currentColor" />}
      </IconButton>
      <span className={cn("shrink-0 text-[11.5px] tabular-nums", kind === "video" ? "text-white/85" : "text-muted-foreground")}>
        {fmt(time)} / {fmt(duration)}
      </span>
      <SeekBar value={time} max={duration} onSeek={(t) => media.current && (media.current.currentTime = t)} dark={kind === "video"} />
      <IconButton label={muted || volume === 0 ? "Unmute" : "Mute"} onClick={toggleMute}>
        {muted || volume === 0 ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
      </IconButton>
      <div className="w-16 shrink-0">
        <SeekBar
          value={muted ? 0 : volume}
          max={1}
          onSeek={(v) => {
            if (!media.current) return;
            media.current.volume = v;
            media.current.muted = v === 0;
          }}
          dark={kind === "video"}
          label="Volume"
        />
      </div>
      <button
        type="button"
        onClick={setRate}
        title="Playback speed"
        className={cn("h-6 min-w-9 shrink-0 rounded-sm px-1 text-[11.5px] font-medium tabular-nums", kind === "video" ? "hover:bg-white/15" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
      >
        {speed}×
      </button>
      {kind === "video" && document.fullscreenEnabled && (
        <IconButton label={fullscreen ? "Exit full screen" : "Full screen"} onClick={toggleFullscreen}>
          {fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
        </IconButton>
      )}
    </div>
  );

  if (kind === "audio") {
    return (
      <div
        className="flex w-full max-w-[520px] items-center gap-3 rounded border bg-muted/40 py-2 pl-2 pr-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        tabIndex={0}
        onKeyDown={onKeyDown}
        data-testid="audio-player"
      >
        <audio ref={media} src={src} preload="metadata" {...events} />
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Pause" : "Play"}
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm hover:opacity-90"
        >
          {playing ? <Pause className="size-4" fill="currentColor" /> : <Play className="size-4 translate-x-px" fill="currentColor" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{name}</span>
            <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
              {fmt(time)} / {fmt(duration)}
            </span>
          </div>
          <SeekBar value={time} max={duration} onSeek={(t) => media.current && (media.current.currentTime = t)} />
        </div>
        {/* Hover the speaker for a vertical volume slider; click it to mute. */}
        <div className="group/vol relative shrink-0">
          <IconButton label={muted || volume === 0 ? "Unmute" : "Mute"} onClick={toggleMute} className="text-muted-foreground hover:bg-muted hover:text-foreground">
            {muted || volume === 0 ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </IconButton>
          <div className="invisible absolute bottom-full left-1/2 z-20 -translate-x-1/2 pb-1.5 opacity-0 transition-opacity group-hover/vol:visible group-hover/vol:opacity-100 group-has-[:focus-visible]/vol:visible group-has-[:focus-visible]/vol:opacity-100">
            <div className="rounded border bg-popover px-2 py-2.5 shadow-lg" data-testid="volume-popup">
              <VerticalSlider
                value={muted ? 0 : volume}
                onChange={(v) => {
                  if (!media.current) return;
                  media.current.volume = v;
                  media.current.muted = v === 0;
                }}
              />
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={setRate}
          title="Playback speed"
          className="h-6 min-w-9 shrink-0 rounded-sm px-1 text-[11.5px] font-medium tabular-nums text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {speed}×
        </button>
      </div>
    );
  }

  return (
    <div
      ref={box}
      className={cn("group/player relative max-w-full overflow-hidden rounded bg-black outline-none focus-visible:ring-2 focus-visible:ring-ring", fullscreen && "flex items-center")}
      style={{ width: fullscreen ? "100%" : (w ?? 560) }}
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-testid="video-player"
    >
      <video ref={media} src={src} preload="metadata" className="block max-h-[inherit] w-full" onClick={toggle} onDoubleClick={toggleFullscreen} {...events} />
      {!playing && (
        <button
          type="button"
          onClick={toggle}
          aria-label="Play"
          className="absolute left-1/2 top-1/2 flex size-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm hover:bg-black/70"
        >
          <Play className="size-5 translate-x-0.5" fill="currentColor" />
        </button>
      )}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent transition-opacity",
          playing ? "opacity-0 group-hover/player:opacity-100 group-focus-within/player:opacity-100" : "opacity-100",
        )}
      >
        {controls}
      </div>
      {!fullscreen && (
        <div
          onPointerDown={startResize}
          title="Drag to resize"
          className="absolute bottom-0 right-0 z-10 size-4 cursor-nwse-resize opacity-0 group-hover/player:opacity-100"
          data-testid="video-resize"
        >
          <svg viewBox="0 0 16 16" className="size-4 text-white/80">
            <path d="M14 6v8H6" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </div>
      )}
    </div>
  );
}

function IconButton({ label, onClick, children, className }: { label: string; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn("flex size-7 shrink-0 items-center justify-center rounded-sm hover:bg-white/15", className)}
    >
      {children}
    </button>
  );
}

/** Horizontal slider (seek position, volume) that follows the pointer while dragging. */
function SeekBar({ value, max, onSeek, dark, label = "Seek" }: { value: number; max: number; onSeek: (v: number) => void; dark?: boolean; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const at = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * max;
  };
  return (
    <div
      ref={ref}
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className="group/seek relative flex h-4 min-w-0 flex-1 cursor-pointer touch-none items-center"
      onPointerDown={(e) => {
        if (!max) return;
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        onSeek(at(e.clientX));
      }}
      onPointerMove={(e) => e.buttons === 1 && max && onSeek(at(e.clientX))}
    >
      <div className={cn("h-1 w-full overflow-hidden rounded-full", dark ? "bg-white/30" : "bg-muted-foreground/25")}>
        <div className={cn("h-full rounded-full", dark ? "bg-white" : "bg-primary")} style={{ width: `${pct}%` }} />
      </div>
      <div
        className={cn("absolute size-2.5 -translate-x-1/2 rounded-full opacity-0 shadow group-hover/seek:opacity-100", dark ? "bg-white" : "bg-primary")}
        style={{ left: `${pct}%` }}
      />
    </div>
  );
}

/** Vertical 0–1 slider (audio volume). Arrow keys work too. */
function VerticalSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const at = (clientY: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (r.bottom - clientY) / r.height));
  };
  const pct = Math.round(value * 100);
  return (
    <div
      ref={ref}
      role="slider"
      aria-label="Volume"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      tabIndex={0}
      className="relative mx-auto flex h-20 w-4 cursor-pointer touch-none justify-center outline-none"
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        onChange(at(e.clientY));
      }}
      onPointerMove={(e) => e.buttons === 1 && onChange(at(e.clientY))}
      onKeyDown={(e) => {
        const step = e.key === "ArrowUp" || e.key === "ArrowRight" ? 0.1 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -0.1 : 0;
        if (!step) return;
        e.preventDefault();
        e.stopPropagation();
        onChange(Math.max(0, Math.min(1, value + step)));
      }}
      data-testid="volume-slider"
    >
      <div className="relative h-full w-1 overflow-hidden rounded-full bg-muted-foreground/25">
        <div className="absolute inset-x-0 bottom-0 rounded-full bg-primary" style={{ height: `${pct}%` }} />
      </div>
      <div className="absolute left-1/2 size-2.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-primary shadow" style={{ bottom: `${pct}%` }} />
    </div>
  );
}
