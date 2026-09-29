import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { Check, Plus, X } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useUI } from "@/app/store";
import { cn } from "@/lib/utils";
import { hexToRgb, hsvToRgb, normalizeHex, readableOn, rgbToHex, rgbToHsv } from "@/lib/colors";

/**
 * The one color system used everywhere (folder colors, highlight color):
 * preset swatches, then the user's custom colors, then a "+" that opens a
 * color wheel. Custom colors are stored once (Settings.customColors), so a
 * color added in one place is offered in every picker.
 */
export interface Swatch {
  /** Value handed to onPick (a preset id or "#rrggbb"). */
  id: string;
  label: string;
  /** CSS color for the dot (may be a light-dark() pair). */
  css: string;
  /** Checkmark color on top of the dot. */
  checkCss?: string;
}

export function SwatchGrid({
  presets,
  value,
  onPick,
  wrap = (el) => el,
  size = "sm",
  label,
}: {
  presets: Swatch[];
  value: string | null | undefined;
  onPick: (id: string) => void;
  /** Inside a menu: wrap each control in a menu item so picking also closes the menu. */
  wrap?: (el: React.ReactElement, key: string) => React.ReactNode;
  size?: "sm" | "md";
  label: string;
}) {
  const custom = useUI((s) => s.settings.customColors);
  const update = useUI((s) => s.updateSetting);
  const swatches: (Swatch & { custom?: boolean })[] = [
    ...presets,
    ...custom.map((hex) => ({ id: hex, label: hex, css: hex, checkCss: readableOn(hex), custom: true })),
  ];
  const dot = size === "md" ? "size-7" : "size-6";

  const add = async () => {
    const hex = await pickNewColor();
    if (!hex) return;
    const list = useUI.getState().settings.customColors;
    if (!list.includes(hex)) await update("customColors", [...list, hex]);
    onPick(hex);
  };

  return (
    <div className={cn("flex flex-wrap", size === "md" ? "gap-2" : "gap-1.5 p-1")} role="radiogroup" aria-label={label}>
      {swatches.map((c) =>
        wrap(
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={value === c.id}
            aria-label={c.label}
            title={c.custom ? `${c.label} (custom)` : c.label}
            onClick={() => onPick(c.id)}
            className={cn(
              "group/swatch relative flex shrink-0 items-center justify-center rounded-full transition-transform hover:scale-110",
              dot,
              value === c.id && "ring-2 ring-foreground/50 ring-offset-2 ring-offset-popover",
            )}
            style={{ background: c.css }}
          >
            {value === c.id && <Check className="size-3.5" style={{ color: c.checkCss ?? "#fff" }} strokeWidth={3} />}
            {c.custom && (
              <span
                role="button"
                aria-label={`Remove ${c.label}`}
                title="Remove this color"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  void update("customColors", custom.filter((x) => x !== c.id));
                }}
                className="absolute -right-1 -top-1 hidden size-3.5 items-center justify-center rounded-full border bg-popover text-muted-foreground group-hover/swatch:flex hover:text-foreground"
              >
                <X className="size-2.5" strokeWidth={3} />
              </span>
            )}
          </button>,
          c.id,
        ),
      )}
      {wrap(
        <button
          key="__add"
          type="button"
          onClick={() => void add()}
          aria-label="Add a color"
          title="Add a color"
          className={cn("flex shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/60 text-muted-foreground hover:border-foreground hover:text-foreground", dot)}
          data-testid="add-color"
        >
          <Plus className="size-3.5" />
        </button>,
        "__add",
      )}
    </div>
  );
}

// ---------------------------------------------------------------- "add color" dialog

interface AddColorState {
  request: { resolve: (hex: string | null) => void } | null;
}
const useAddColor = create<AddColorState>(() => ({ request: null }));

/** Opens the color wheel; resolves with the chosen "#rrggbb" or null. Works from inside menus. */
export function pickNewColor(): Promise<string | null> {
  return new Promise((resolve) => {
    useAddColor.getState().request?.resolve(null);
    // Let a menu that triggered this close first, so it doesn't steal focus back.
    setTimeout(() => useAddColor.setState({ request: { resolve } }), 0);
  });
}

/** Mount once per window. */
export function AddColorDialogHost() {
  const request = useAddColor((s) => s.request);
  const close = (hex: string | null) => {
    request?.resolve(hex);
    useAddColor.setState({ request: null });
  };
  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && close(null)}>
      {request && (
        <DialogContent title="Add a color" className="w-[340px]" data-testid="add-color-dialog">
          <ColorEditor onAdd={(hex) => close(hex)} onCancel={() => close(null)} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function ColorEditor({ onAdd, onCancel }: { onAdd: (hex: string) => void; onCancel: () => void }) {
  const [hsv, setHsv] = useState<[number, number, number]>([210, 0.7, 0.9]);
  const [hexText, setHexText] = useState("");
  const rgb = hsvToRgb(...hsv).map(Math.round) as [number, number, number];
  const hex = rgbToHex(...rgb);
  useEffect(() => setHexText(hex), [hex]);

  const setFromRgb = (r: number, g: number, b: number) => setHsv(rgbToHsv(r, g, b));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center gap-5">
        <ColorWheel hsv={hsv} onChange={setHsv} />
        <div className="size-12 shrink-0 rounded border" style={{ background: hex }} aria-hidden data-testid="color-preview" />
      </div>

      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-xs">
        <label htmlFor="brightness" className="text-muted-foreground">
          Brightness
        </label>
        <input
          id="brightness"
          type="range"
          min={0}
          max={100}
          value={Math.round(hsv[2] * 100)}
          onChange={(e) => setHsv([hsv[0], hsv[1], Number(e.target.value) / 100])}
          className="h-4 w-full cursor-pointer"
          style={{ accentColor: hex }}
        />
        <label htmlFor="hex-input" className="text-muted-foreground">
          Hex
        </label>
        <input
          id="hex-input"
          value={hexText}
          onChange={(e) => {
            setHexText(e.target.value);
            const n = normalizeHex(e.target.value);
            if (n) setFromRgb(...hexToRgb(n));
          }}
          onKeyDown={(e) => e.key === "Enter" && onAdd(hex)}
          className="h-7 w-full rounded-sm border border-input bg-transparent px-2 font-mono text-xs outline-none focus:border-ring"
          spellCheck={false}
          data-testid="hex-input"
        />
        <span className="text-muted-foreground">RGB</span>
        <div className="flex gap-1.5">
          {(["R", "G", "B"] as const).map((ch, i) => (
            <input
              key={ch}
              type="number"
              min={0}
              max={255}
              value={rgb[i]}
              onChange={(e) => {
                const next = [...rgb] as [number, number, number];
                next[i] = Math.max(0, Math.min(255, Number(e.target.value) || 0));
                setFromRgb(...next);
              }}
              aria-label={ch}
              title={ch}
              className="h-7 w-full min-w-0 rounded-sm border border-input bg-transparent px-1.5 font-mono text-xs outline-none focus:border-ring"
            />
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => onAdd(hex)} data-testid="add-color-confirm">
          Add
        </Button>
      </div>
    </div>
  );
}

/** Hue around the circle (red at the top, clockwise), saturation from the centre outwards. */
function ColorWheel({ hsv, onChange }: { hsv: [number, number, number]; onChange: (hsv: [number, number, number]) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [h, s, v] = hsv;
  const R = 88; // radius in px (w-44)

  const pick = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const hue = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    const sat = Math.min(1, Math.hypot(dx, dy) / (r.width / 2));
    // Picking on a black wheel would do nothing visible; bring the brightness up.
    onChange([hue, sat, v < 0.15 ? 1 : v]);
  };

  const angle = (h * Math.PI) / 180;
  return (
    <div
      ref={ref}
      className="relative size-44 shrink-0 cursor-crosshair touch-none rounded-full"
      style={{
        background:
          "radial-gradient(circle closest-side, #fff, transparent), conic-gradient(red, yellow, lime, cyan, blue, magenta, red)",
      }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        pick(e);
      }}
      onPointerMove={(e) => e.buttons === 1 && pick(e)}
      role="slider"
      aria-label="Color wheel"
      aria-valuetext={rgbToHex(...hsvToRgb(h, s, v))}
      data-testid="color-wheel"
    >
      <div className="pointer-events-none absolute inset-0 rounded-full bg-black" style={{ opacity: 1 - v }} />
      <div
        className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
        style={{ left: R + Math.sin(angle) * s * R, top: R - Math.cos(angle) * s * R, background: rgbToHex(...hsvToRgb(h, s, v)) }}
      />
    </div>
  );
}
