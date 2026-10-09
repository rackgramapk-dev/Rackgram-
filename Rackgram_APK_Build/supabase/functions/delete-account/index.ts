// Supabase Edge Function: delete-account (deployed to project rjdcajjtfchyfvsfmohp, verify_jwt=false, checks the user itself)
// Deletes the calling user's account. All user data cascades from auth.users.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const sb = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });
    const { data: u, error: ue } = await sb.auth.getUser();
    if (ue || !u?.user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    if (body.confirm !== "DELETE") return json({ error: "confirmation required" }, 400);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const uid = u.user.id;

    for (const bucket of ["avatars", "chat-media"]) {
      try {
        const { data: files } = await admin.storage.from(bucket).list(uid, { limit: 1000 });
        if (files && files.length) await admin.storage.from(bucket).remove(files.map((f) => uid + "/" + f.name));
      } catch (_) { /* ignore */ }
    }

    const { error: de } = await admin.auth.admin.deleteUser(uid);
    if (de) return json({ error: de.message }, 500);
    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
