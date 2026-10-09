// Supabase Edge Function: notif-action  (verify_jwt = false; authenticated by per-device secret)
// Used by the Android notification "Reply" / reaction buttons.
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const res = (s: number, b: unknown = { ok: s < 300 }) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return res(405);
  try {
    const { dk, secret, action, to, msg_id, text, emoji, call_id } = await req.json();
    if (typeof dk !== "string" || typeof secret !== "string" || secret.length < 32 || dk.length > 64) return res(401);

    const { data: devs } = await sb.from("devices").select("user_id")
      .eq("device_key", dk).eq("reply_hash", await sha256(secret)).eq("revoked", false).limit(1);
    const uid = devs?.[0]?.user_id as string | undefined;
    if (!uid) return res(401);

    // Decline an incoming call straight from the call notification
    if (action === "decline_call") {
      const cid = String(call_id ?? "");
      if (!UUID.test(cid)) return res(400);
      const { error } = await sb.from("call_participants")
        .update({ status: "declined", updated_at: new Date().toISOString() })
        .eq("call_id", cid).eq("user_id", uid).eq("status", "invited");
      if (error) return res(500, { error: error.message });
      return res(200);
    }

    if (typeof to !== "string" || !UUID.test(to) || to === uid) return res(400);

    // never act if either side blocked the other
    const { data: bl } = await sb.from("blocks").select("blocker_id")
      .or(`and(blocker_id.eq.${to},blocked_id.eq.${uid}),and(blocker_id.eq.${uid},blocked_id.eq.${to})`).limit(1);
    if (bl?.length) return res(403);

    const markRead = () => sb.from("messages").update({ read_at: new Date().toISOString() })
      .eq("receiver_id", uid).eq("sender_id", to).is("read_at", null);

    if (action === "reply") {
      const body = typeof text === "string" ? text.trim() : "";
      if (body.length < 1 || body.length > 4000) return res(400);
      const { error } = await sb.from("messages").insert({ sender_id: uid, receiver_id: to, body });
      if (error) return res(500, { error: error.message });
      await markRead();
      return res(200);
    }

    if (action === "react") {
      const mid = Number(msg_id);
      if (!Number.isSafeInteger(mid) || typeof emoji !== "string" || emoji.length < 1 || emoji.length > 16) return res(400);
      const { data: m } = await sb.from("messages").select("id,sender_id,receiver_id").eq("id", mid).maybeSingle();
      if (!m || ![m.sender_id, m.receiver_id].includes(uid)) return res(403);
      const { error } = await sb.from("message_reactions")
        .upsert({ message_id: mid, user_id: uid, emoji }, { onConflict: "message_id,user_id" });
      if (error) return res(500, { error: error.message });
      await markRead();
      return res(200);
    }

    return res(400);
  } catch (e) {
    return res(500, { error: String(e) });
  }
});
