import { useEffect, useState } from "react";
import { Select } from "@/components/ui/select";
import { showError } from "@/components/Toasts";
import { getPluginValue, setPluginValue } from "@/data/pluginStorage";

export type CommentsFilter = "all" | "mentions";

const KEY = "notifications.comments";

export const getCommentsFilter = () => getPluginValue<CommentsFilter>("jira", KEY, "all");

/** Under the comment notifications' switch: every comment, or only the ones that mention me. */
export function CommentsOption() {
  const [value, setValue] = useState<CommentsFilter | null>(null);
  useEffect(() => {
    let live = true;
    void getCommentsFilter().then((v) => live && setValue(v));
    return () => {
      live = false;
    };
  }, []);
  if (!value) return null;
  return (
    <Select<CommentsFilter>
      value={value}
      onChange={(v) => {
        setValue(v);
        setPluginValue("jira", KEY, v).catch((e) => showError(e, "Couldn't save"));
      }}
      options={[
        { value: "all", label: "All comments" },
        { value: "mentions", label: "Only comments that mention you" },
      ]}
      aria-label="Which comments"
      className="w-full"
    />
  );
}
