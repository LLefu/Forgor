import { useEffect, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { Bell, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { clearNotifications, deleteNotification, loadNotificationHistory, markNotificationRead, openNotification, useNotificationHistory, type HistoryEntry } from "@/app/notifications";
import { getPlugin } from "@/plugins/registry";

/**
 * Sidebar, next to Settings: the bell. A dot while there are unread
 * notifications; the menu lists the recent ones (app/notifications.ts). A
 * notification stays unread until it's clicked (which also opens what it's
 * about: the ticket, the PR); hovering one shows a button to delete it.
 */
export function NotificationsMenu() {
  const entries = useNotificationHistory((s) => s.entries);
  const [open, setOpen] = useState(false);
  const unread = entries.some((e) => !e.read);

  useEffect(() => {
    void loadNotificationHistory();
  }, []);

  const click = (e: HistoryEntry) => {
    void markNotificationRead(e.id);
    openNotification(e);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip content="Notifications">
        <PopoverTrigger asChild>
          <button
            className={cn("relative flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground", open && "bg-muted text-foreground")}
            aria-label={unread ? "Notifications (unread)" : "Notifications"}
            data-testid="notifications-button"
            data-unread={unread}
          >
            <Bell className="size-4" />
            {unread && <span className="absolute right-1 top-1 size-2 rounded-full bg-primary ring-2 ring-sidebar" data-testid="notifications-unread" />}
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent side="top" align="start" className="w-80 p-0" data-testid="notifications-menu">
        <div className="flex h-9 items-center justify-between border-b px-3">
          <span className="text-[13px] font-medium">Notifications</span>
          {entries.length > 0 && (
            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => void clearNotifications()} data-testid="notifications-clear">
              Clear all
            </button>
          )}
        </div>
        {entries.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">No notifications yet.</p>
        ) : (
          <ul className="max-h-96 overflow-y-auto py-1">
            {entries.map((e) => {
              const Icon = getPlugin(e.source)?.icon ?? Bell;
              return (
                <li key={e.id} className="group relative">
                  <button
                    onClick={() => click(e)}
                    className={cn("flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-muted", !e.read && "bg-accent/60")}
                    data-testid="notification-entry"
                  >
                    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{e.title}</span>
                      <span className="line-clamp-2 text-xs text-muted-foreground">{e.body}</span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">{formatDistanceToNowStrict(new Date(e.at), { addSuffix: true })}</span>
                    </span>
                    {!e.read && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary group-hover:invisible" aria-label="New" />}
                  </button>
                  <button
                    onClick={() => void deleteNotification(e.id)}
                    className="absolute right-2 top-2 hidden size-5 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground group-hover:flex"
                    aria-label="Delete notification"
                    data-testid="notification-delete"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
