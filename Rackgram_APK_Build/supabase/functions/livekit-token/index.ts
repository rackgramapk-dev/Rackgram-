// Supabase Edge Function: livekit-token
// Secrets needed: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const enc = new TextEncoder();
const b64u = (b: Uint8Array | string) => {
  const u = typeof b === "string" ? enc.encode(b) : b;
  let s = "";
  u.forEach((c) => (s += String.fromCharCode(c)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
async function sign(payload: Record<string, unknown>, secret: string) {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify(payload));
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(h + "." + p)));
  return h + "." + p + "." + b64u(sig);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("LIVEKIT_URL"), key = Deno.env.get("LIVEKIT_API_KEY"), secret = Deno.env.get("LIVEKIT_API_SECRET");
    if (!url || !key || !secret) return json({ error: "LiveKit secrets missing" }, 500);

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });
    const { data: u, error: ue } = await sb.auth.getUser();
    if (ue || !u?.user) return json({ error: "unauthorized" }, 401);

    const { call_id } = await req.json();
    if (!call_id) return json({ error: "call_id required" }, 400);

    // RLS: this only returns the call if the user is the caller or an invited participant
    const { data: call } = await sb.from("calls").select("id,status").eq("id", call_id).maybeSingle();
    if (!call || ["ended", "missed", "declined"].includes(call.status)) return json({ error: "call not available" }, 403);

    const { data: prof } = await sb.from("profiles").select("name").eq("id", u.user.id).maybeSingle();
    const now = Math.floor(Date.now() / 1000);
    const token = await sign({
      iss: key,
      sub: u.user.id,
      name: prof?.name || "User",
      nbf: now - 10,
      exp: now + 2 * 60 * 60,
      video: { room: call.id, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true },
    }, secret);

    return json({ token, url });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
