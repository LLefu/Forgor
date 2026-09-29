import { useState } from "react";
import { Check, ChevronDown, Folder as FolderIcon, Inbox, Palette } from "lucide-react";
import { useFolders } from "@/app/queries";
import { setFolderColor } from "@/data/notes";
import { FOLDER_COLORS, effectiveFolderColor } from "@/lib/folderColors";
import { basename } from "@/lib/paths";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SwatchGrid, type Swatch } from "@/components/ColorPicker";

/** Effective (own or inherited) color of a folder, as a CSS color, or null. */
export function useFolderColor(folderId: string | null | undefined): string | null {
  const { data: folders = [] } = useFolders();
  return effectiveFolderColor(folderId, folders);
}

/** Folder icon + name in the folder's color. Used wherever a folder is referenced. */
export function FolderLabel({
  folderId,
  fallback,
  full,
  className,
}: {
  folderId: string | null;
  fallback?: string | null;
  /** Show the full path instead of the last segment. */
  full?: boolean;
  className?: string;
}) {
  const { data: folders = [] } = useFolders();
  const folder = folders.find((f) => f.id === folderId);
  const color = effectiveFolderColor(folderId, folders);
  if (!folderId || !folder) {
    return (
      <span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
        <Inbox className="size-3 shrink-0" /> <span className="truncate">{fallback ?? "Inbox"}</span>
      </span>
    );
  }
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", className)} data-testid="folder-label">
      <FolderIcon className="size-3 shrink-0" style={color ? { color, fill: `color-mix(in srgb, ${color} 25%, transparent)` } : undefined} />
      <span className="truncate">{full ? folder.path : basename(folder.path)}</span>
    </span>
  );
}

const FOLDER_SWATCHES: Swatch[] = FOLDER_COLORS.map((c) => ({ id: c.id, label: c.label, css: c.hex }));

/**
 * Folder color swatches (presets + custom colors + "add"); `value` null = no own
 * color (inherits). Inside a menu, pass `wrap` so choosing one also closes the menu.
 */
export function ColorSwatches({
  value,
  onPick,
  wrap = (el) => el,
}: {
  value: string | null | undefined;
  onPick: (id: string | null) => void;
  wrap?: (el: React.ReactElement, key: string) => React.ReactNode;
}) {
  return (
    <div className="w-[212px]">
      <SwatchGrid presets={FOLDER_SWATCHES} value={value} onPick={onPick} wrap={wrap} label="Folder color" />
      {wrap(
        <button
          key="none"
          type="button"
          onClick={() => onPick(null)}
          className="mt-1 w-full rounded-sm px-1 py-1 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {value ? "Remove color (use parent folder's)" : "No own color (uses parent folder's)"}
        </button>,
        "none",
      )}
    </div>
  );
}

/** Button + popover to set a folder's color. */
export function FolderColorButton({ folderId }: { folderId: string }) {
  const { data: folders = [] } = useFolders();
  const [open, setOpen] = useState(false);
  const own = folders.find((f) => f.id === folderId)?.color ?? null;
  const color = effectiveFolderColor(folderId, folders);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex h-7 items-center gap-1.5 rounded border px-2 text-xs hover:bg-muted" data-testid="folder-color-button">
          {color ? <span className="size-3 rounded-full" style={{ background: color }} /> : <Palette className="size-3.5 text-muted-foreground" />}
          Color
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-1.5" align="end">
        <ColorSwatches
          value={own}
          onPick={(c) => {
            void setFolderColor(folderId, c);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** Folder chooser with color dots (native <select> can't show colors). */
export function FolderSelect({
  value,
  onChange,
  className,
  testId,
}: {
  value: string | null;
  onChange: (folderId: string | null) => void;
  className?: string;
  testId?: string;
}) {
  const { data: folders = [] } = useFolders();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const options = folders.filter((f) => !q || f.path.toLowerCase().includes(q.toLowerCase()));
  const pick = (id: string | null) => {
    onChange(id);
    setOpen(false);
    setQ("");
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn("inline-flex h-7 min-w-0 max-w-full items-center justify-between gap-1 rounded border border-transparent px-1.5 text-[13px] hover:border-input data-[state=open]:border-ring", className)}
          data-testid={testId}
          aria-label="Folder"
        >
          <FolderLabel folderId={value} fallback="Inbox (no folder)" full />
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-1">
        {folders.length > 6 && (
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find folder…"
            className="mb-1 h-8 w-full rounded-sm border bg-transparent px-2 text-sm outline-none focus:border-ring"
          />
        )}
        <div className="max-h-72 overflow-y-auto">
          <FolderOption selected={value === null} onClick={() => pick(null)}>
            <FolderLabel folderId={null} fallback="Inbox (no folder)" />
          </FolderOption>
          {options.map((f) => (
            <FolderOption key={f.id} selected={value === f.id} onClick={() => pick(f.id)}>
              <span style={{ paddingLeft: (f.path.split("/").length - 1) * 12 }} className="min-w-0">
                <FolderLabel folderId={f.id} />
              </span>
            </FolderOption>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function FolderOption({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] hover:bg-muted", selected && "bg-accent text-accent-foreground")}>
      <span className="min-w-0 flex-1">{children}</span>
      {selected && <Check className="size-3.5 shrink-0" />}
    </button>
  );
}
