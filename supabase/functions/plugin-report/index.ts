// POST { id, reason }: someone reports a plugin (broken, harmful, spam…). You read them in the dashboard.
import { admin, caller, json, limit, PLUGIN_ID, Refused, serve } from "../_shared/store.ts";

serve(async (req) => {
  const { id, reason } = (await req.json().catch(() => ({}))) as { id?: unknown; reason?: unknown };
  if (typeof id !== "string" || !PLUGIN_ID.test(id)) throw new Refused(400, "Which plugin?");
  const text = typeof reason === "string" ? reason.trim().slice(0, 2000) : "";
  if (!text) throw new Refused(400, "Say what's wrong with it.");
  const db = admin();
  await limit(db, `report:${await caller(req)}`, 3600, 10, "Too many reports from here for now. Try again later.");
  const { data: plugin } = await db.from("plugins").select("id").eq("id", id).maybeSingle();
  if (!plugin) throw new Refused(404, "That plugin isn't in the store.");
  const { error } = await db.from("plugin_reports").insert({ plugin_id: id, reason: text });
  if (error) throw error;
  return json({ ok: true }, 201);
});
