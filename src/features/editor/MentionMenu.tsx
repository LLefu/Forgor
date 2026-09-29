import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, FileText, Link2Off, Rows3, Link2 } from "lucide-react";
import type { MentionTarget } from "./linkPlugins";

export interface MentionMenuState {
  target: MentionTarget;
  rect: DOMRect;
}

/** Small menu under a clicked "@" link: open it, show the whole note inline (or back to a link), or unlink. */
export function MentionMenu({
  state,
  onClose,
  onOpen,
  onEmbed,
  onShowAsLink,
  onUnlink,
}: {
  state: MentionMenuState;
  onClose: () => void;
  onOpen: () => void;
  onEmbed: () => void;
  onShowAsLink: () => void;
  onUnlink: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { kind } = state.target;

  useEffect(() => {
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    const onScroll = () => onClose();
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    document.getElementById("note-scroll")?.addEventListener("scroll", onScroll);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      document.getElementById("note-scroll")?.removeEventListener("scroll", onScroll);
    };
  }, [onClose]);

  const item = (icon: React.ReactNode, label: string, onClick: () => void, testId?: string) => (
    <button
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        onClick();
        onClose();
      }}
      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-muted [&_svg]:size-4 [&_svg]:text-muted-foreground"
      data-testid={testId}
    >
      {icon}
      {label}
    </button>
  );

  const openLabel = kind === "todo" ? "Open todo" : kind === "folder" ? "Open folder" : "Open note";
  return createPortal(
    <div
      ref={ref}
      className="fixed z-50 min-w-48 rounded border bg-popover p-1 text-[13px] shadow-lg"
      style={{ left: state.rect.left, top: state.rect.bottom + 4 }}
      data-testid="mention-menu"
    >
      {item(<ArrowUpRight />, openLabel, onOpen, "mention-open")}
      {kind === "note" && item(<Rows3 />, "Show entire note", onEmbed, "mention-embed")}
      {kind === "embed" && item(<Link2 />, "Show as link", onShowAsLink, "mention-as-link")}
      <div className="my-1 h-px bg-border" />
      {item(<Link2Off />, "Remove link (keep text)", onUnlink)}
      <p className="flex items-center gap-1 px-2 pb-1 pt-1.5 text-[11px] text-muted-foreground">
        <FileText className="size-3" /> Ctrl/⌘+click opens it directly
      </p>
    </div>,
    document.body,
  );
}
