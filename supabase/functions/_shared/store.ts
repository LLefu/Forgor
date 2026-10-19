// Shared by the plugin store's edge functions. They run with the secret key (they bypass RLS),
// so every write to the store goes through here and is checked first.
import { createClient } from "npm:@supabase/supabase-js@2";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-publish-key, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

/** A request we refuse, with the reason the app shows. */
export class Refused extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Runs a handler with CORS, POST-only and errors as { error } JSON. */
export function serve(handler: (req: Request) => Promise<Response>) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (req.method !== "POST") return json({ error: "Use POST." }, 405);
    try {
      return await handler(req);
    } catch (e) {
      if (e instanceof Refused) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "Something went wrong in the store. Try again later." }, 500);
    }
  });
}

const secretKey = () => {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}") as Record<string, string>;
    if (keys.default) return keys.default;
  } catch {
    // fall back to the legacy key
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
};

export const admin = () => createClient(Deno.env.get("SUPABASE_URL")!, secretKey(), { auth: { persistSession: false } });

export async function sha256(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Who is asking, without keeping their IP: a hash of it (for rate limits only). */
export async function caller(req: Request): Promise<string> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return (await sha256(`forgor-store:${ip}`)).slice(0, 24);
}

/** Throws when `bucket` was hit more than `max` times in the current window. */
export async function limit(db: ReturnType<typeof admin>, bucket: string, windowSeconds: number, max: number, message: string) {
  const { data, error } = await db.rpc("hit_rate_limit", { p_bucket: bucket, p_window_seconds: windowSeconds, p_max: max });
  if (error) throw error;
  if (data === false) throw new Refused(429, message);
}

export const PLUGIN_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;

/** a > b for "x.y.z". */
export function newer(a: string, b: string) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i];
  return false;
}
