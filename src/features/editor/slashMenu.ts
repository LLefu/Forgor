import type { Ctx } from "@milkdown/kit/ctx";

/**
 * Extra words the slash menu matches on, next to the label ("/h1" finds
 * "Heading 1"). Needs scripts/patch-crepe.mjs, which makes Crepe's filter
 * look at `keywords`.
 */
export const SLASH_KEYWORDS: Record<string, string> = {
  text: "p paragraph plain",
  h1: "h1 # title",
  h2: "h2 ##",
  h3: "h3 ###",
  h4: "h4",
  h5: "h5",
  h6: "h6",
  quote: "q blockquote > \"",
  toggle: "details collapse fold expand summary",
  divider: "hr line --- separator",
  "bullet-list": "ul bullets - unordered",
  "ordered-list": "ol numbered 1.",
  "task-list": "todo task checkbox [] tl",
  image: "img picture photo",
  code: "codeblock pre snippet",
  table: "tbl grid",
  "link-note": "note link mention @",
  document: "doc file attach attachment upload pdf",
  video: "vid movie mp4 clip",
  audio: "sound music mp3 voice recording",
};

const icon = (paths: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const noteLinkIcon = icon(
  '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 13.5a2.5 2.5 0 0 1 0 3.5l-.5.5a2.5 2.5 0 0 1-3.5-3.5l.5-.5"/><path d="M14 16.5a2.5 2.5 0 0 1 0-3.5l.5-.5a2.5 2.5 0 0 1 3.5 3.5l-.5.5"/>',
);
const videoIcon = icon('<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>');
const audioIcon = icon('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>');
const toggleIcon = icon('<path d="m6 7 4 3-4 3"/><path d="M13 10h7"/><path d="M10 17h10"/>');
/** For plugin items without an icon of their own. */
export const pluginItemIcon = icon('<path d="M12 3v18"/><path d="M3 12h18"/>');
const paperclipIcon = icon('<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>');

interface Item {
  key: string;
  keywords?: string;
}
interface Builder {
  getGroup: (key: string) => { group: { items: Item[] } };
  addGroup: (
    key: string,
    label: string,
  ) => { addItem: (key: string, item: { label: string; icon: string; onRun: (ctx: Ctx) => void }) => unknown };
}

/** A plugin's "/" item (editor.slashItems), grouped under the plugin's name. */
export interface ExtraSlashItem {
  key: string;
  group: string;
  label: string;
  icon?: string;
  keywords?: string;
  onRun: (ctx: Ctx) => void;
}

export function buildSlashMenu(
  builder: Builder,
  actions: {
    linkNote: (ctx: Ctx) => void;
    attachFile: (ctx: Ctx, kind: "document" | "image" | "video" | "audio") => void;
    toggle: (ctx: Ctx) => void;
    extra: ExtraSlashItem[];
  },
) {
  // Toggle sits right after Quote.
  try {
    const items = builder.getGroup("text").group.items as (Item & { label: string; icon: string; onRun: (ctx: Ctx) => void })[];
    const at = items.findIndex((i) => i.key === "quote");
    items.splice(at < 0 ? items.length : at + 1, 0, { key: "toggle", label: "Toggle", icon: toggleIcon, onRun: actions.toggle });
  } catch {
    // text group disabled
  }
  const links = builder.addGroup("links", "Links & media");
  links.addItem("link-note", { label: "Link to note", icon: noteLinkIcon, onRun: actions.linkNote });
  links.addItem("document", { label: "Document", icon: paperclipIcon, onRun: (c) => actions.attachFile(c, "document") });
  links.addItem("video", { label: "Video", icon: videoIcon, onRun: (c) => actions.attachFile(c, "video") });
  links.addItem("audio", { label: "Audio", icon: audioIcon, onRun: (c) => actions.attachFile(c, "audio") });
  const groups = new Map<string, ReturnType<Builder["addGroup"]>>();
  for (const item of actions.extra) {
    let group = groups.get(item.group);
    if (!group) groups.set(item.group, (group = builder.addGroup(`plugin-${groups.size}`, item.group)));
    group.addItem(item.key, { label: item.label, icon: item.icon ?? pluginItemIcon, onRun: item.onRun });
    SLASH_KEYWORDS[item.key] = item.keywords ?? "";
  }
  for (const key of ["text", "list", "advanced", "links", ...[...groups.keys()].map((_, i) => `plugin-${i}`)]) {
    let group;
    try {
      group = builder.getGroup(key).group;
    } catch {
      continue; // group disabled
    }
    for (const item of group.items) {
      item.keywords = SLASH_KEYWORDS[item.key];
      // /image also offers the images already in the folder first.
      if (item.key === "image") (item as Item & { onRun?: (ctx: Ctx) => void }).onRun = (c) => actions.attachFile(c, "image");
    }
  }
}
