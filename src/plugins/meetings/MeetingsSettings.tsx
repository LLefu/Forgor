import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Setting } from "../ui";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { confirmDialog } from "@/components/ConfirmDialog";
import { useUI } from "@/app/store";
import { configureNative } from "./state";
import { meetings } from "@/platform/meetings";
import { useQuery } from "@tanstack/react-query";
import { forgetVoice, listVoices } from "@/data/voices";

/** The meetings plugin's settings: microphone, known voices and the summary language. */
export function MeetingsSettings() {
  const settings = useUI((s) => s.settings);
  const update = useUI((s) => s.updateSetting);
  const [devices, setDevices] = useState<string[]>([]);

  useEffect(() => {
    meetings()
      .inputDevices()
      .then((d) => setDevices(d.devices))
      .catch(() => setDevices([]));
  }, []);

  return (
    <>
      <Setting label="Microphone" hint="Your voice is recorded from this microphone. The other people in a call come from the computer's sound.">
        <Select<string>
          aria-label="Microphone"
          value={settings.meetingMic ?? ""}
          onChange={async (v) => {
            await update("meetingMic", v || null);
            await configureNative();
          }}
          options={[{ value: "", label: "System default" }, ...devices.map((d) => ({ value: d, label: d }))]}
          className="w-full"
        />
      </Setting>
      <Setting label="Summary language" hint="Dutch and English speech are both recognized, also mixed. This sets the language of the summary and labels.">
        <Select
          aria-label="Summary language"
          value={settings.meetingLanguage}
          onChange={(v) => update("meetingLanguage", v)}
          options={[
            { value: "auto", label: "Same as the meeting" },
            { value: "nl", label: "Always Dutch" },
            { value: "en", label: "Always English" },
          ]}
          className="w-full"
        />
      </Setting>
      <KnownVoices />
    </>
  );
}

/** The people Forgor recognizes by voice, with a way to forget them. */
function KnownVoices() {
  const { data: voices = [] } = useQuery({ queryKey: ["voices"], queryFn: listVoices });
  return (
    <Setting
      label="Known voices"
      hint="When you name a speaker, Forgor remembers their voice and fills in the name in later meetings. A voice fingerprint is about 2 KB, stored only in the app's database on this computer, never in your notes."
    >
      {voices.length === 0 ? (
        <p className="text-xs text-muted-foreground">None yet. Name the speakers of a recording to add them.</p>
      ) : (
        <ul className="divide-y rounded border" data-testid="known-voices">
          {voices.map((v) => (
            <li key={v.name} className="flex items-center gap-2 px-2.5 py-1.5">
              <span className="flex-1 text-[13px]">{v.name}</span>
              <span className="text-xs text-muted-foreground">
                {v.meetings} {v.meetings === 1 ? "meeting" : "meetings"}
              </span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Forget ${v.name}'s voice`}
                onClick={async () => {
                  const ok = await confirmDialog({
                    title: `Forget ${v.name}'s voice?`,
                    message: "Forgor won't recognize them anymore. Names already in your notes stay.",
                    confirmLabel: "Forget",
                    destructive: true,
                  });
                  if (ok) await forgetVoice(v.name);
                }}
              >
                <Trash2 /> Forget
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Setting>
  );
}
