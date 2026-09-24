import { Fragment, useMemo } from "react";
import { Download } from "lucide-react";
import { format, parseISO } from "date-fns";
import changelogMd from "../../../CHANGELOG.md?raw";
import { parseChangelog, type ChangelogVersion } from "@/lib/changelog";
import { useUpdates } from "@/app/updates";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The changelog bundled with this build. "Unreleased" only shows in development builds. */
function bundledVersions(): ChangelogVersion[] {
  return parseChangelog(changelogMd).filter((v) => v.version !== "Unreleased" || import.meta.env.DEV);
}

export function VersionHistoryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { version: installed, status, install } = useUpdates();
  const versions = useMemo(bundledVersions, []);
  // A newer release isn't in this build's changelog yet; show it from the update's release notes.
  const available = status.kind === "available" || status.kind === "installing" || status.kind === "ready" ? status.update : null;
  const availableEntry: ChangelogVersion | null =
    available && !versions.some((v) => v.version === available.version)
      ? { version: available.version, date: available.date?.slice(0, 10) ?? null, groups: parseChangelog(`## x\n${available.notes}`)[0]?.groups ?? [] }
      : null;
  const all = availableEntry ? [availableEntry, ...versions] : versions;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent title="Version history" className="top-[8%] w-[640px]" data-testid="version-history">
          <div className="max-h-[70vh] space-y-6 overflow-y-auto pr-1">
            {all.length === 0 && <p className="text-sm text-muted-foreground">No changelog available.</p>}
            {all.map((v) => {
              const isInstalled = v.version === installed;
              const isAvailable = v === availableEntry || v.version === available?.version;
              return (
                <section key={v.version} className="border-b pb-5 last:border-0" data-testid="changelog-version">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold">{v.version === "Unreleased" ? "Unreleased" : `Forgor ${v.version}`}</h3>
                    {v.date && <span className="text-xs text-muted-foreground">{format(parseISO(v.date), "d MMMM yyyy")}</span>}
                    {isInstalled && <Badge tone="primary">Installed</Badge>}
                    {v.version === "Unreleased" && <Badge>In development</Badge>}
                    {isAvailable && !isInstalled && <Badge tone="primary">Available</Badge>}
                    {isAvailable && status.kind === "available" && (
                      <Button size="sm" className="ml-auto" onClick={install}>
                        <Download /> Install update
                      </Button>
                    )}
                  </div>
                  {v.groups.length === 0 && <p className="text-sm text-muted-foreground">No details.</p>}
                  {v.groups.map((g, i) => (
                    <Fragment key={i}>
                      {g.title && <h4 className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{g.title}</h4>}
                      <ul className="list-disc space-y-1 pl-5 text-sm marker:text-muted-foreground">
                        {g.items.map((item, j) => (
                          <li key={j}>
                            <Inline text={item} />
                          </li>
                        ))}
                      </ul>
                    </Fragment>
                  ))}
                </section>
              );
            })}
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: "primary" }) {
  return (
    <span
      className={cn(
        "rounded-sm px-1.5 py-0.5 text-[11px] font-medium",
        tone === "primary" ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

/** Minimal inline markdown: **bold** and `code`. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i}>{p.slice(2, -2)}</strong>
        ) : p.startsWith("`") && p.endsWith("`") ? (
          <code key={i} className="rounded-sm bg-muted px-1 font-mono text-[12px]">
            {p.slice(1, -1)}
          </code>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}
