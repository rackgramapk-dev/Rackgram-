package com.rackgram.app;

import android.app.ActivityManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.service.notification.StatusBarNotification;

import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;
import androidx.core.app.RemoteInput;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.List;
import java.util.Map;

/** Builds a messaging-style notification with Reply + reaction buttons from a data-only FCM push. */
public class RackgramMessagingService extends FirebaseMessagingService {
    static final String CH = "rackgram_messages";
    static final String KEY_REPLY = "rg_reply";

    @Override
    public void onMessageReceived(RemoteMessage rm) {
        Map<String, String> d = rm.getData();
        String type = d.get("type");
        if ("call_end".equals(type)) { cancelCall(this, d.get("call_id")); return; }
        if ("call".equals(type)) {
            if (isForeground(this)) return; // app is open: realtime already rings in-app
            postCall(this, d.get("call_id"), d.get("name"), d.get("kind"));
            return;
        }
        if ("gmsg".equals(type)) {
            if (isForeground(this)) return;
            postGroup(this, d.get("group_id"), d.get("title"), d.get("body"), "1".equals(d.get("snd")), "1".equals(d.get("vib")));
            return;
        }
        if (!"msg".equals(type)) return;
        if (isForeground(this)) return; // app is open: realtime already shows it
        String sid = d.get("sender_id");
        if (sid == null) return;
        String title = d.get("title") != null ? d.get("title") : "Rackgram";
        String body = d.get("body") != null ? d.get("body") : "";
        post(this, sid, title, d.get("msg_id"), body, "1".equals(d.get("snd")), "1".equals(d.get("vib")));
    }

    static boolean isForeground(Context c) {
        try {
            ActivityManager am = (ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE);
            List<ActivityManager.RunningAppProcessInfo> l = am.getRunningAppProcesses();
            if (l == null) return false;
            for (ActivityManager.RunningAppProcessInfo p : l) {
                if (p.processName.equals(c.getPackageName())) {
                    return p.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND;
                }
            }
        } catch (Exception ignored) { }
        return false;
    }

    static void ensureChannel(Context c) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm.getNotificationChannel(CH) == null) {
                NotificationChannel ch = new NotificationChannel(CH, "Messages", NotificationManager.IMPORTANCE_HIGH);
                ch.enableVibration(true);
                nm.createNotificationChannel(ch);
            }
        }
    }

    static NotificationCompat.MessagingStyle existingStyle(Context c, int nid) {
        if (Build.VERSION.SDK_INT >= 23) {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            for (StatusBarNotification sn : nm.getActiveNotifications()) {
                if (sn.getId() == nid) {
                    NotificationCompat.MessagingStyle s =
                            NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(sn.getNotification());
                    if (s != null) return s;
                }
            }
        }
        return null;
    }

    /** New incoming message: append to the conversation notification and show it. */
    static void post(Context c, String sid, String title, String msgId, String body, boolean snd, boolean vib) {
        ensureChannel(c);
        int nid = sid.hashCode();
        NotificationCompat.MessagingStyle style = existingStyle(c, nid);
        if (style == null) style = new NotificationCompat.MessagingStyle(new Person.Builder().setName("You").build());
        Person sender = new Person.Builder().setName(title).setKey(sid).build();
        style.addMessage(body, System.currentTimeMillis(), sender);
        show(c, nid, sid, title, msgId, style, !snd && !vib, snd, vib, false);
    }

    static void show(Context c, int nid, String sid, String title, String msgId,
                     NotificationCompat.MessagingStyle style, boolean silent, boolean snd, boolean vib, boolean quiet) {
        ensureChannel(c);
        int icon = c.getResources().getIdentifier("ic_launcher_foreground", "mipmap", c.getPackageName());
        if (icon == 0) icon = c.getApplicationInfo().icon;

        // tap -> open the chat (same extras the Capacitor push plugin understands)
        Intent launch = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        if (launch == null) launch = new Intent();
        launch.putExtra("google.message_id", "rg" + msgId);
        launch.putExtra("sender_id", sid);
        launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(c, nid, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        int mut = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
        RemoteInput ri = new RemoteInput.Builder(KEY_REPLY).setLabel("Reply").build();
        NotificationCompat.Action reply = new NotificationCompat.Action.Builder(
                android.R.drawable.ic_menu_send, "Reply", actionIntent(c, "rg.REPLY", nid, sid, title, msgId, null, 1, mut))
                .addRemoteInput(ri)
                .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
                .setAllowGeneratedReplies(true)
                .build();
        NotificationCompat.Action love = new NotificationCompat.Action.Builder(
                0, "\u2764\uFE0F", actionIntent(c, "rg.REACT", nid, sid, title, msgId, "\u2764\uFE0F", 2, PendingIntent.FLAG_IMMUTABLE)).build();
        NotificationCompat.Action like = new NotificationCompat.Action.Builder(
                0, "\uD83D\uDC4D", actionIntent(c, "rg.REACT", nid, sid, title, msgId, "\uD83D\uDC4D", 3, PendingIntent.FLAG_IMMUTABLE)).build();

        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CH)
                .setSmallIcon(icon)
                .setStyle(style)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(tap)
                .setWhen(System.currentTimeMillis())
                .addAction(reply).addAction(love).addAction(like);
        if (quiet || silent) b.setSilent(true);
        else if (!vib) b.setVibrate(new long[]{0});
        else if (!snd) b.setSound(null);

        Notification n = b.build();
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        try { nm.notify(nid, n); } catch (SecurityException ignored) { }
    }

    static PendingIntent actionIntent(Context c, String action, int nid, String sid, String title,
                                      String msgId, String emoji, int slot, int flags) {
        Intent i = new Intent(c, NotifActionReceiver.class).setAction(action)
                .putExtra("nid", nid).putExtra("sender_id", sid).putExtra("title", title)
                .putExtra("msg_id", msgId).putExtra("emoji", emoji);
        return PendingIntent.getBroadcast(c, nid * 4 + slot, i, PendingIntent.FLAG_UPDATE_CURRENT | flags);
    }

    // ---------------------------------------------------------------- incoming calls
    static final String CH_CALL = "rackgram_calls_v1";

    static int callNid(String callId) { return ("call" + callId).hashCode(); }

    static void ensureCallChannel(Context c) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm.getNotificationChannel(CH_CALL) == null) {
                NotificationChannel ch = new NotificationChannel(CH_CALL, "Incoming calls", NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("Rings when someone calls you");
                ch.enableVibration(true);
                ch.setVibrationPattern(new long[]{0, 600, 400, 600, 400, 600});
                ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                ch.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
                        new AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SONIC).build());
                nm.createNotificationChannel(ch);
            }
        }
    }

    private static PendingIntent viewIntent(Context c, int code, String uri) {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(uri)).setPackage(c.getPackageName());
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(c, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Full-screen ringing notification with Answer / Decline. Works with the app closed and the phone locked. */
    static void postCall(Context c, String callId, String name, String kind) {
        if (callId == null) return;
        ensureCallChannel(c);
        int nid = callNid(callId);
        int icon = c.getResources().getIdentifier("ic_launcher_foreground", "mipmap", c.getPackageName());
        if (icon == 0) icon = c.getApplicationInfo().icon;
        String who = name != null ? name : "Rackgram";

        PendingIntent open = viewIntent(c, nid, "rackgram://call?id=" + callId);
        PendingIntent answer = viewIntent(c, nid + 1, "rackgram://call?id=" + callId + "&accept=1");
        Intent dec = new Intent(c, NotifActionReceiver.class).setAction("rg.CALL_DECLINE")
                .putExtra("call_id", callId).putExtra("nid", nid);
        PendingIntent decline = PendingIntent.getBroadcast(c, nid + 2, dec, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Person caller = new Person.Builder().setName(who).setImportant(true).build();
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CH_CALL)
                .setSmallIcon(icon)
                .setContentTitle(who)
                .setContentText("video".equals(kind) ? "Incoming video call" : "Incoming voice call")
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setTimeoutAfter(45000)
                .setContentIntent(open)
                .setFullScreenIntent(open, true)
                .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, decline, answer));
        Notification n = b.build();
        n.flags |= Notification.FLAG_INSISTENT; // keep ringing until answered / cancelled / timed out
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        try { nm.notify(nid, n); } catch (SecurityException ignored) { }
    }

    static void cancelCall(Context c, String callId) {
        if (callId == null) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        nm.cancel(callNid(callId));
    }

    // ---------------------------------------------------------------- group / channel messages
    static void postGroup(Context c, String gid, String title, String body, boolean snd, boolean vib) {
        if (gid == null) return;
        ensureChannel(c);
        int nid = ("g" + gid).hashCode();
        int icon = c.getResources().getIdentifier("ic_launcher_foreground", "mipmap", c.getPackageName());
        if (icon == 0) icon = c.getApplicationInfo().icon;
        NotificationCompat.MessagingStyle style = existingStyle(c, nid);
        if (style == null) style = new NotificationCompat.MessagingStyle(new Person.Builder().setName("You").build());
        style.setConversationTitle(title != null ? title : "Rackgram").setGroupConversation(true);
        style.addMessage(body != null ? body : "", System.currentTimeMillis(), (Person) null);
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CH)
                .setSmallIcon(icon)
                .setStyle(style)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(viewIntent(c, nid, "rackgram://group?id=" + gid))
                .setWhen(System.currentTimeMillis());
        if (!snd && !vib) b.setSilent(true);
        else if (!vib) b.setVibrate(new long[]{0});
        else if (!snd) b.setSound(null);
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        try { nm.notify(nid, b.build()); } catch (SecurityException ignored) { }
    }
}
