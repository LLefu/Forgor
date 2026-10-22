import { useEffect, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { boot, chooseVault, type BootResult } from "./boot";
import { queryClient } from "./queries";
import { useUI } from "./store";
import { useApplyTheme } from "./theme";
import { useZoom } from "./zoom";
import { Shell } from "./Shell";
import { VaultSetup } from "./VaultSetup";
import { loadSettings } from "@/data/settings";
import { installPlugin, loadCommunityPluginsOnce } from "@/plugins/community";
import { usePluginsVersion } from "@/plugins/registry";
import { storeApi } from "@/platform/store";
import type { PluginFiles } from "@/platform/plugins";
import { zipPlugin } from "@/plugins/zip";
import { fakeJira } from "@/platform/jira";
import { fakeBitbucket } from "@/platform/bitbucket";
import { playedSounds, sentNotifications } from "@/platform/notifications";
import { checkNotificationsNow } from "./notifications";

export default function App() {
  const [state, setState] = useState<BootResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const initSettings = useUI((s) => s.initSettings);
  // Installing or removing a plugin remounts the app (see usePluginsVersion).
  const pluginsVersion = usePluginsVersion((s) => s.version);
  useApplyTheme();
  useZoom();

  useEffect(() => {
    boot()
      .then(async (r) => {
        await loadCommunityPluginsOnce();
        // Browser/dev only: e2e tests install plugins without a folder dialog.
        if (r.platform.kind === "memory") Object.assign((window as unknown as { __wn: object }).__wn, {
            installPlugin,
            store: storeApi(),
            /** Publish plugin files to the fake store as someone else would. */
            publishToStore: (files: PluginFiles, key: string | null) => storeApi().publish(zipPlugin(files), key),
            fakeJira,
            fakeBitbucket,
            notifications: {
              sent: sentNotifications,
              played: playedSounds,
              /** Run the checks now, past the lists' one-minute cache. */
              check: async () => {
                await queryClient.invalidateQueries({ queryKey: ["jira"] });
                await queryClient.invalidateQueries({ queryKey: ["bitbucket"] });
                await checkNotificationsNow();
              },
            },
          });
        initSettings(r.settings);
        setState(r);
      })
      .catch((e) => {
        console.error(e);
        setError(String(e?.message ?? e));
      });
  }, [initSettings]);

  if (error) {
    return (
      <div className="p-8 text-sm">
        <h1 className="font-semibold text-destructive">Could not start</h1>
        <pre className="mt-2 whitespace-pre-wrap text-muted-foreground">{error}</pre>
      </div>
    );
  }
  if (!state) return <div className="h-full bg-background" />;

  if (state.needsVault) {
    return (
      <VaultSetup
        platform={state.platform}
        onChosen={async (path) => {
          await chooseVault(state.platform, path);
          const settings = await loadSettings(state.platform.sql);
          initSettings(settings);
          setState({ ...state, settings, needsVault: false });
        }}
      />
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <Shell key={pluginsVersion} platform={state.platform} />
    </QueryClientProvider>
  );
}
