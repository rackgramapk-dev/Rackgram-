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
    iss: SA.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const pem = SA.private_key.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(head + "." + claim));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: head + "." + claim + "." + b64u(sig) }),
  });
  return (await r.json()).access_token as string;
}


async function sendTo(SA: any, tok: string, d: any, payload: any) {
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${SA.project_id}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { token: d.fcm_token, ...payload } }),
  });
  if (r.status === 404 || r.status === 400) {
    const t = await r.text();
    if (t.includes("UNREGISTERED") || t.includes("INVALID_ARGUMENT")) await sb.from("devices").update({ fcm_token: null }).eq("id", d.id);
  }
}

// Group / channel message -> push to every member except the sender (respects mute, DND, group_notif, preview)
async function groupPush(m: any) {
  if (!m?.group_id || !m?.sender_id) return new Response("ok");
  const [g, mem, sp, mu] = await Promise.all([
    sb.from("groups").select("name,kind").eq("id", m.group_id).maybeSingle(),
    sb.from("group_members").select("user_id").eq("group_id", m.group_id).neq("user_id", m.sender_id),
    sb.from("profiles").select("name").eq("id", m.sender_id).maybeSingle(),
    sb.from("muted_chats").select("user_id").eq("chat_id", m.group_id),
  ]);
  const mutedSet = new Set((mu.data ?? []).map((x: any) => x.user_id));
  const ids = (mem.data ?? []).map((x: any) => x.user_id).filter((u: string) => !mutedSet.has(u));
  if (!ids.length) return new Response("no members");
  const [sts, dvs] = await Promise.all([
    sb.from("user_settings").select("*").in("user_id", ids),
    sb.from("devices").select("id,user_id,fcm_token,reply_hash").in("user_id", ids).eq("revoked", false).not("fcm_token", "is", null),
  ]);
  const S: Record<string, any> = {};
  (sts.data ?? []).forEach((x: any) => (S[x.user_id] = x));
  const devs = (dvs.data ?? []).filter((d: any) => {
    const s = S[d.user_id];
    return !(s && (s.group_notif === false || s.msg_notif === false || (s.dnd_until && new Date(s.dnd_until) > new Date())));
  });
  if (!devs.length) return new Response("no devices");
  const SA = JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT") ?? "{}");
  const tok = await accessToken(SA);
  const title = g.data?.name ?? "Rackgram";
  const who = g.data?.kind === "channel" ? "" : (sp.data?.name ?? "") + ": ";
  const text = String(m.body ?? "").slice(0, 120);
  for (const d of devs) {
    const s = S[d.user_id];
    const body = s?.show_preview === false ? "New message" : who + text;
    await sendTo(SA, tok, d, d.reply_hash
      ? { data: { type: "gmsg", group_id: String(m.group_id), msg_id: String(m.id), title, body,
                  snd: s?.sound === false ? "0" : "1", vib: s?.vibration === false ? "0" : "1" },
          android: { priority: "HIGH" } }
      : { notification: { title, body }, data: { group_id: String(m.group_id) },
          android: { priority: "HIGH", notification: { sound: s?.sound === false ? undefined : "default" } } });
  }
  return new Response("sent");
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("WEBHOOK_SECRET");
  if (!secret || req.headers.get("x-webhook-secret") !== secret) return new Response("unauthorized", { status: 401 });
  try {
    const body0 = await req.json();
    if (body0.table === "group_messages") return await groupPush(body0.record);
    const m = body0.record;
    if (!m?.receiver_id) return new Response("ok");
    const [st, mu, dv, sp, nk] = await Promise.all([
      sb.from("user_settings").select("*").eq("user_id", m.receiver_id).maybeSingle(),
      sb.from("muted_chats").select("chat_id").eq("user_id", m.receiver_id).eq("chat_id", m.sender_id),
      sb.from("devices").select("id,fcm_token,reply_hash").eq("user_id", m.receiver_id).eq("revoked", false).not("fcm_token", "is", null),
      sb.from("profiles").select("name").eq("id", m.sender_id).maybeSingle(),
      sb.from("contact_names").select("name").eq("user_id", m.receiver_id).eq("contact_id", m.sender_id).maybeSingle(),
    ]);
    const s = st.data;
    if (s && (s.msg_notif === false || (s.dnd_until && new Date(s.dnd_until) > new Date()))) return new Response("muted");
    if (mu.data?.length) return new Response("chat muted");
    const devs = dv.data ?? [];
    if (!devs.length) return new Response("no devices");
    const SA = JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT") ?? "{}");
    const tok = await accessToken(SA);
    const title = nk.data?.name ?? sp.data?.name ?? "Rackgram";
    const body = s?.show_preview === false ? "New message" : String(m.body).slice(0, 120);
    for (const d of devs) {
      // New app builds (reply_hash set) get a data-only push and build the notification
      // themselves (Reply / reaction buttons). Older builds keep the plain notification push.
      const payload = d.reply_hash
        ? {
            token: d.fcm_token,
            data: {
              type: "msg",
              sender_id: String(m.sender_id),
              msg_id: String(m.id),
              title,
              body,
              snd: s?.sound === false ? "0" : "1",
              vib: s?.vibration === false ? "0" : "1",
            },
            android: { priority: "HIGH" },
          }
        : {
            token: d.fcm_token,
            notification: { title, body },
            data: { sender_id: String(m.sender_id) },
            android: { priority: "HIGH", notification: { sound: s?.sound === false ? undefined : "default", default_vibrate_timings: s?.vibration !== false } },
          };
      const r = await fetch(`https://fcm.googleapis.com/v1/projects/${SA.project_id}/messages:send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: payload }),
      });
      if (r.status === 404 || r.status === 400) {
        const t = await r.text();
        if (t.includes("UNREGISTERED") || t.includes("INVALID_ARGUMENT")) await sb.from("devices").update({ fcm_token: null }).eq("id", d.id);
      }
    }
    return new Response("sent");
  } catch (e) {
    return new Response(String(e), { status: 500 });
  }
});
