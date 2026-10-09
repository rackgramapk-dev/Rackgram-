package com.rackgram.app;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;

import androidx.core.app.NotificationCompat;
import androidx.core.app.RemoteInput;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Handles Reply / reaction buttons from the notification shade. */
public class NotifActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(final Context c, Intent i) {
        final PendingResult pr = goAsync();
        final String act = i.getAction();
        final String sid = i.getStringExtra("sender_id");
        final String title = i.getStringExtra("title");
        final String msgId = i.getStringExtra("msg_id");
        final String emoji = i.getStringExtra("emoji");
        final int nid = i.getIntExtra("nid", 0);
        final String callId = i.getStringExtra("call_id");
        String t = null;
        Bundle r = RemoteInput.getResultsFromIntent(i);
        if (r != null && r.getCharSequence(RackgramMessagingService.KEY_REPLY) != null) {
            t = r.getCharSequence(RackgramMessagingService.KEY_REPLY).toString().trim();
        }
        final String text = t;
        new Thread(() -> {
            boolean ok = false;
            try {
                if ("rg.REPLY".equals(act)) {
                    if (text != null && !text.isEmpty()) ok = call(c, "reply", sid, msgId, text, null);
                } else if ("rg.REACT".equals(act)) {
                    ok = call(c, "react", sid, msgId, null, emoji);
                } else if ("rg.CALL_DECLINE".equals(act)) {
                    ok = callDecline(c, callId);
                }
            } catch (Exception ignored) { }
            finish(c, act, ok, nid, sid, title, msgId, text);
            pr.finish();
        }).start();
    }

    private static boolean call(Context c, String action, String sid, String msgId, String text, String emoji) throws Exception {
        SharedPreferences sp = c.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
        String dk = sp.getString("rg_dk", null), rs = sp.getString("rg_rs", null), fn = sp.getString("rg_fn", null);
        if (dk == null || rs == null || fn == null) return false;
        JSONObject j = new JSONObject();
        j.put("dk", dk).put("secret", rs).put("action", action).put("to", sid);
        if (msgId != null) j.put("msg_id", msgId);
        if (text != null) j.put("text", text);
        if (emoji != null) j.put("emoji", emoji);
        HttpURLConnection h = (HttpURLConnection) new URL(fn).openConnection();
        h.setRequestMethod("POST");
        h.setConnectTimeout(10000);
        h.setReadTimeout(15000);
        h.setDoOutput(true);
        h.setRequestProperty("Content-Type", "application/json");
        try (OutputStream os = h.getOutputStream()) { os.write(j.toString().getBytes("UTF-8")); }
        int code = h.getResponseCode();
        h.disconnect();
        return code >= 200 && code < 300;
    }

    private static boolean callDecline(Context c, String callId) throws Exception {
        if (callId == null) return false;
        SharedPreferences sp = c.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
        String dk = sp.getString("rg_dk", null), rs = sp.getString("rg_rs", null), fn = sp.getString("rg_fn", null);
        if (dk == null || rs == null || fn == null) return false;
        JSONObject j = new JSONObject();
        j.put("dk", dk).put("secret", rs).put("action", "decline_call").put("call_id", callId);
        HttpURLConnection h = (HttpURLConnection) new URL(fn).openConnection();
        h.setRequestMethod("POST");
        h.setConnectTimeout(10000);
        h.setReadTimeout(15000);
        h.setDoOutput(true);
        h.setRequestProperty("Content-Type", "application/json");
        try (OutputStream os = h.getOutputStream()) { os.write(j.toString().getBytes("UTF-8")); }
        int code = h.getResponseCode();
        h.disconnect();
        return code >= 200 && code < 300;
    }

    private static void finish(final Context c, String act, boolean ok, int nid, String sid,
                               String title, String msgId, String text) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if ("rg.CALL_DECLINE".equals(act)) { nm.cancel(nid); return; }
        if ("rg.REACT".equals(act)) {
            if (ok) nm.cancel(nid); else toast(c, "Couldn't react");
            return;
        }
        // reply: re-post the same notification (clears the spinner) with our reply shown
        NotificationCompat.MessagingStyle style = RackgramMessagingService.existingStyle(c, nid);
        if (style == null) { if (ok) nm.cancel(nid); return; }
        if (ok) {
            style.addMessage(text, System.currentTimeMillis(), (androidx.core.app.Person) null);
        } else {
            toast(c, "Reply failed");
        }
        RackgramMessagingService.show(c, nid, sid, title, msgId, style, true, false, false, true);
    }

    private static void toast(final Context c, final String m) {
        new Handler(Looper.getMainLooper()).post(() -> Toast.makeText(c, m, Toast.LENGTH_SHORT).show());
    }
}
