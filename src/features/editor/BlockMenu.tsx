import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Code, Heading1, Heading2, Heading3, List, ListOrdered, ListTodo, Quote, Type, Puzzle } from "lucide-react";
import { BLOCK_KINDS, type BlockKind } from "./turnInto";

export interface BlockMenuState {
  rect: DOMRect;
  /** What this block can become. */
  kinds: BlockKind[];
  /** Plugins' items for this block. */
  extra: { id: string; label: string; group: string }[];
}

const ICONS: Record<BlockKind, React.ReactNode> = {
  text: <Type />,
  h1: <Heading1 />,
  h2: <Heading2 />,
  h3: <Heading3 />,
  bullet: <List />,
  numbered: <ListOrdered />,
  todo: <ListTodo />,
  toggle: <ChevronRight />,
  quote: <Quote />,
  code: <Code />,
};

/** The drag handle's menu: turn the block into another kind, and plugins' items. */
export function BlockMenu({
  state,
  onClose,
  onTurnInto,
  onExtra,
}: {
  state: BlockMenuState;
  onClose: () => void;
  onTurnInto: (kind: BlockKind) => void;
  onExtra: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = [...(ref.current?.querySelectorAll("button") ?? [])];
        const at = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }
    };
    const onScroll = () => onClose();
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    document.getElementById("note-scroll")?.addEventListener("scroll", onScroll);
    ref.current?.querySelector("button")?.focus();
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      document.getElementById("note-scroll")?.removeEventListener("scroll", onScroll);
    };
  }, [onClose]);

  const item = (icon: React.ReactNode, label: string, onClick: () => void, testId: string) => (
    <button
      key={testId}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        onClose();
        onClick();
      }}
      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:bg-muted [&_svg]:size-4 [&_svg]:text-muted-foreground"
      data-testid={testId}
    >
      {icon}
      {label}
    </button>
  );

  const left = Math.min(state.rect.left, window.innerWidth - 220);
  const top = Math.min(state.rect.bottom + 4, window.innerHeight - 40);
  const groups = [...new Set(state.extra.map((e) => e.group))];
  return createPortal(
    <div
      ref={ref}
      className="fixed z-50 max-h-[70vh] min-w-52 overflow-y-auto rounded border bg-popover p-1 text-[13px] shadow-lg"
      style={{ left, top }}
      data-testid="block-menu"
      role="menu"
    >
      {state.kinds.length > 0 && (
        <>
          <p className="px-2 pb-1 pt-1 text-[11px] font-medium text-muted-foreground">Turn into</p>
          {BLOCK_KINDS.filter((k) => state.kinds.includes(k.kind)).map((k) => item(ICONS[k.kind], k.label, () => onTurnInto(k.kind), `turn-into-${k.kind}`))}
        </>
      )}
      {groups.map((group, i) => (
        <div key={group}>
          {(i > 0 || state.kinds.length > 0) && <div className="my-1 h-px bg-border" />}
          <p className="px-2 pb-1 pt-1 text-[11px] font-medium text-muted-foreground">{group}</p>
          {state.extra.filter((e) => e.group === group).map((e) => item(<Puzzle />, e.label, () => onExtra(e.id), `block-item-${e.id}`))}
        </div>
      ))}
    </div>,
    document.body,
  );
}
