// POST { id } after installing a plugin from the store: counts it (once a day per computer).
import { admin, caller, json, limit, PLUGIN_ID, Refused, serve } from "../_shared/store.ts";

serve(async (req) => {
  const { id } = (await req.json().catch(() => ({}))) as { id?: unknown };
  if (typeof id !== "string" || !PLUGIN_ID.test(id)) throw new Refused(400, "Which plugin?");
  const db = admin();
  const who = await caller(req);
  await limit(db, `installs:${who}`, 3600, 60, "Too many installs from here for now.");
  // The same computer installing again (or updating) the same day doesn't count again.
  const first = await db.rpc("hit_rate_limit", { p_bucket: `install:${who}:${id}`, p_window_seconds: 86400, p_max: 1 });
  if (first.error) throw first.error;
  if (first.data) {
    const { error } = await db.rpc("count_install", { p_id: id });
    if (error) throw error;
  }
  return json({ ok: true });
});
