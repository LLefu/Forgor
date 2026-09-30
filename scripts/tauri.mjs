// Runs the Tauri CLI. `tauri dev` gets tauri.dev.conf.json merged in: its own
// app identifier, so dev has a separate database and settings (and notes in
// dev-vault/) and runs next to an installed Forgor instead of handing off to it.
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
if (args[0] === "dev" && !args.includes("--config") && !args.includes("-c")) {
  args.splice(1, 0, "--config", "src-tauri/tauri.dev.conf.json");
}
const { status } = spawnSync(process.execPath, ["node_modules/@tauri-apps/cli/tauri.js", ...args], { stdio: "inherit" });
process.exit(status ?? 1);
