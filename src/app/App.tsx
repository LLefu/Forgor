import { useEffect, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { boot, chooseVault, type BootResult } from "./boot";
import { queryClient } from "./queries";
import { useUI } from "./store";
import { useApplyTheme } from "./theme";
import { Shell } from "./Shell";
import { VaultSetup } from "./VaultSetup";
import { loadSettings } from "@/data/settings";

export default function App() {
  const [state, setState] = useState<BootResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const initSettings = useUI((s) => s.initSettings);
  useApplyTheme();

  useEffect(() => {
    boot()
      .then((r) => {
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
      <Shell platform={state.platform} />
    </QueryClientProvider>
  );
}
