import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Loader2, Paperclip } from "lucide-react";
import { mediaAttachments, type AdfNode, type JiraAttachment } from "@/lib/jira";
import { useAttachmentUrl } from "./state";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { openExternal } from "@/platform/os";
import { format } from "date-fns";

/**
 * Jira's rich text (Atlassian Document Format) as React elements. Built from
 * the document tree instead of Jira's rendered HTML, so nothing from Jira can
 * run in the app; unknown node types show their text. Images are fetched with
 * the login (app/jira.ts) and shown; other files open in Jira.
 */
export function JiraDoc({
  doc,
  issueUrl,
  attachments = [],
  fallbackInOrder = false,
}: {
  doc: AdfNode | null;
  issueUrl?: string;
  attachments?: JiraAttachment[];
  /** Images without a file name take the ticket's image attachments in order (the description only). */
  fallbackInOrder?: boolean;
}) {
  const media = useMemo(() => mediaAttachments(doc, attachments, fallbackInOrder), [doc, attachments, fallbackInOrder]);
  if (!doc?.content?.length) return <p className="text-sm text-muted-foreground">No description.</p>;
  return (
    <MediaContext.Provider value={media}>
      <div className="jira-doc space-y-2 text-[13.5px] leading-relaxed">{render(doc.content, issueUrl)}</div>
    </MediaContext.Provider>
  );
}

const MediaContext = createContext<Map<AdfNode, JiraAttachment>>(new Map());

/** An image from the ticket; click for full size. Falls back to a link to Jira. */
function JiraImage({ attachment, node, fallback }: { attachment: JiraAttachment; node: AdfNode; fallback: ReactNode }) {
  const { data: url, isLoading, error } = useAttachmentUrl(attachment.id, attachment.mimeType);
  const [zoom, setZoom] = useState(false);
  const width = Number(node.attrs?.width) || undefined;
  if (error) return <>{fallback}</>;
  if (isLoading || !url)
    return (
      <span className="flex h-24 w-full max-w-sm items-center justify-center rounded border bg-muted/40 text-xs text-muted-foreground">
        <Loader2 className="mr-1.5 size-3.5 animate-spin" /> {attachment.filename}
      </span>
    );
  return (
    <>
      <img
        src={url}
        alt={attachment.filename}
        title={attachment.filename}
        style={width ? { width } : undefined}
        className="max-w-full cursor-zoom-in rounded border"
        onClick={() => setZoom(true)}
        data-testid="jira-image"
      />
      {zoom && (
        <Dialog open onOpenChange={setZoom}>
          <DialogContent title={attachment.filename} className="top-[5%] w-auto max-w-[90vw]">
            <img src={url} alt={attachment.filename} className="max-h-[80vh] max-w-full object-contain" />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

const safeUrl = (url: unknown) => (typeof url === "string" && /^(https?:|mailto:)/i.test(url) ? url : null);

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        void openExternal(href);
      }}
      className="text-primary underline underline-offset-2"
    >
      {children}
    </a>
  );
}

function render(nodes: AdfNode[] | undefined, issueUrl?: string): ReactNode[] {
  return (nodes ?? []).map((n, i) => <Node key={i} node={n} issueUrl={issueUrl} />);
}

function Text({ node }: { node: AdfNode }) {
  let out: ReactNode = node.text ?? "";
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case "strong":
        out = <strong>{out}</strong>;
        break;
      case "em":
        out = <em>{out}</em>;
        break;
      case "underline":
        out = <u>{out}</u>;
        break;
      case "strike":
        out = <s>{out}</s>;
        break;
      case "code":
        out = <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">{out}</code>;
        break;
      case "subsup":
        out = mark.attrs?.type === "sub" ? <sub>{out}</sub> : <sup>{out}</sup>;
        break;
      case "link": {
        const href = safeUrl(mark.attrs?.href);
        if (href) out = <Link href={href}>{out}</Link>;
        break;
      }
    }
  }
  return <>{out}</>;
}

function Node({ node, issueUrl }: { node: AdfNode; issueUrl?: string }): ReactNode {
  const kids = render(node.content, issueUrl);
  const a = node.attrs ?? {};
  switch (node.type) {
    case "text":
      return <Text node={node} />;
    case "paragraph":
      return <p className="min-h-[1em] whitespace-pre-wrap">{kids}</p>;
    case "hardBreak":
      return <br />;
    case "heading": {
      const level = Math.min(Math.max(Number(a.level) || 3, 1), 6);
      const cls = level <= 2 ? "text-base font-semibold" : "text-sm font-semibold";
      return <p className={`mt-3 ${cls}`}>{kids}</p>;
    }
    case "bulletList":
      return <ul className="list-disc space-y-0.5 pl-5">{kids}</ul>;
    case "orderedList":
      return (
        <ol className="list-decimal space-y-0.5 pl-5" start={Number(a.order) || 1}>
          {kids}
        </ol>
      );
    case "listItem":
      return <li className="[&>p]:min-h-0">{kids}</li>;
    case "taskList":
      return <ul className="space-y-0.5">{kids}</ul>;
    case "taskItem":
      return (
        <li className="flex items-start gap-2">
          <input type="checkbox" checked={a.state === "DONE"} readOnly disabled className="mt-1" />
          <span>{kids}</span>
        </li>
      );
    case "decisionList":
      return <ul className="space-y-0.5">{kids}</ul>;
    case "decisionItem":
      return <li>✓ {kids}</li>;
    case "codeBlock":
      return <pre className="overflow-x-auto rounded bg-muted p-2.5 font-mono text-[12px] leading-snug">{node.content?.map((t) => t.text ?? "").join("")}</pre>;
    case "blockquote":
      return <blockquote className="border-l-2 pl-3 text-muted-foreground">{kids}</blockquote>;
    case "panel":
      return <div className="rounded border bg-muted/50 p-2.5">{kids}</div>;
    case "rule":
      return <hr className="my-3" />;
    case "mention":
      return <span className="rounded bg-primary/10 px-1 text-primary">{String(a.text ?? "@someone")}</span>;
    case "emoji":
      return <span>{String(a.text ?? a.shortName ?? "")}</span>;
    case "status":
      return <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold uppercase">{String(a.text ?? "")}</span>;
    case "date": {
      const ts = Number(a.timestamp);
      return <span className="rounded bg-muted px-1">{Number.isFinite(ts) ? format(new Date(ts), "d MMM yyyy") : ""}</span>;
    }
    case "inlineCard":
    case "blockCard":
    case "embedCard": {
      const href = safeUrl(a.url);
      return href ? <Link href={href}>{href}</Link> : null;
    }
    case "mediaSingle":
    case "mediaGroup":
      return <div className="flex flex-wrap gap-2">{kids}</div>;
    case "media":
    case "mediaInline":
      return <Media node={node} issueUrl={issueUrl} />;
    case "expand":
    case "nestedExpand":
      return (
        <details className="rounded border px-2.5 py-1.5">
          <summary className="cursor-pointer text-sm font-medium">{String(a.title ?? "Details")}</summary>
          <div className="mt-2 space-y-2">{kids}</div>
        </details>
      );
    case "table":
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <tbody>{kids}</tbody>
          </table>
        </div>
      );
    case "tableRow":
      return <tr>{kids}</tr>;
    case "tableHeader":
      return <th className="border bg-muted/50 px-2 py-1 text-left font-semibold">{kids}</th>;
    case "tableCell":
      return <td className="border px-2 py-1 align-top">{kids}</td>;
    default:
      return kids.length ? <>{kids}</> : node.text ? <>{node.text}</> : null;
  }
}

function Media({ node, issueUrl }: { node: AdfNode; issueUrl?: string }) {
  const attachment = useContext(MediaContext).get(node);
  const label = attachment?.filename || String(node.attrs?.alt ?? node.attrs?.__fileName ?? "Attachment");
  const chip = (
    <span className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs">
      <Paperclip className="size-3.5" /> {label}
      {issueUrl && " (open in Jira)"}
    </span>
  );
  const link = issueUrl ? <Link href={issueUrl}>{chip}</Link> : chip;
  if (attachment?.mimeType.startsWith("image/")) return <JiraImage attachment={attachment} node={node} fallback={link} />;
  return link;
}
