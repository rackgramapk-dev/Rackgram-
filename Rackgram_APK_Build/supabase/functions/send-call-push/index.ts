// Supabase Edge Function: send-call-push  (verify_jwt = false; called by DB triggers with x-webhook-secret)
// Rings the phone even when the app is closed: data-only HIGH priority FCM -> native full-screen call notification.
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const b64u = (b: ArrayBuffer | string) => {
  const s = typeof b === "string" ? btoa(b) : btoa(String.fromCharCode(...new Uint8Array(b)));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
async function accessToken(SA: any) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64u(JSON.stringify({
    iss: SA.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const pem = SA.private_key.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(head + "." + claim));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: head + "." + claim + "." + b64u(sig) }),
  });
  return (await r.json()).access_token as string;
}

async function fcm(SA: any, tok: string, d: { id: string; fcm_token: string }, data: Record<string, string>) {
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${SA.project_id}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { token: d.fcm_token, data, android: { priority: "HIGH", ttl: "45s" } } }),
  });
  if (r.status === 404 || r.status === 400) {
    const t = await r.text();
    if (t.includes("UNREGISTERED") || t.includes("INVALID_ARGUMENT")) await sb.from("devices").update({ fcm_token: null }).eq("id", d.id);
  }
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("WEBHOOK_SECRET");
  if (!secret || req.headers.get("x-webhook-secret") !== secret) return new Response("unauthorized", { status: 401 });
  try {
    const p = await req.json();
    const callId = String(p.call_id ?? "");
    if (!callId) return new Response("ok");
    const SA = JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT") ?? "{}");

    // ---- cancel ringing on the user's devices (answered elsewhere / caller hung up / declined) ----
    if (p.type === "end") {
      let uids: string[] = [];
      if (p.user_id) uids = [String(p.user_id)];
      else {
        const { data } = await sb.from("call_participants").select("user_id").eq("call_id", callId).eq("status", "invited");
        uids = (data ?? []).map((x) => x.user_id);
      }
      if (!uids.length) return new Response("none");
      const { data: devs } = await sb.from("devices").select("id,fcm_token").in("user_id", uids).eq("revoked", false).not("fcm_token", "is", null);
      if (!devs?.length) return new Response("no devices");
      const tok = await accessToken(SA);
      await Promise.all(devs.map((d) => fcm(SA, tok, d as any, { type: "call_end", call_id: callId })));
      return new Response("ended");
    }

    // ---- incoming call ----
    if (p.type !== "invite") return new Response("ok");
    const uid = String(p.user_id), from = String(p.invited_by);
    const { data: call } = await sb.from("calls").select("id,kind,status,caller_id").eq("id", callId).maybeSingle();
    if (!call || call.status !== "ringing" && call.status !== "active") return new Response("not ringing");
    const [st, dv, sp, nk] = await Promise.all([
      sb.from("user_settings").select("dnd_until").eq("user_id", uid).maybeSingle(),
      sb.from("devices").select("id,fcm_token").eq("user_id", uid).eq("revoked", false).not("fcm_token", "is", null),
      sb.from("profiles").select("name").eq("id", from).maybeSingle(),
      sb.from("contact_names").select("name").eq("user_id", uid).eq("contact_id", from).maybeSingle(),
    ]);
    if (st.data?.dnd_until && new Date(st.data.dnd_until) > new Date()) return new Response("dnd");
    const devs = dv.data ?? [];
    if (!devs.length) return new Response("no devices");
    const tok = await accessToken(SA);
    const name = nk.data?.name ?? sp.data?.name ?? "Rackgram";
    await Promise.all(devs.map((d) => fcm(SA, tok, d as any, {
      type: "call", call_id: callId, caller_id: from, name, kind: call.kind,
    })));
    return new Response("rung");
  } catch (e) {
    return new Response(String(e), { status: 500 });
  }
});
