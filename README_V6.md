# Rackgram v6 – what changed

App (index.html): reply (swipe right or tap menu), edit (own text, 48h), voice notes, video (max 3 min / 50 MB, in-app recorder + gallery),
real groups & channels (create, join by link/username, members, admins, group photo, description, rename, permissions: who can send messages / photos+voice+video / react, leave, delete), reactions on group messages (double-tap or menu), pin (max 5) + archive,
search inside a chat, date separators, clickable links, scroll-to-latest button, privacy (hide last seen / read receipts),
disappearing messages (per chat), offline retry queue for text messages, call answer/decline from notification.
File sending: NOT included (as requested). App lock: NOT included (as requested). End-to-end encryption: NOT included.

Android: android-native/MainActivity.java (new), RackgramMessagingService.java (call + group notifications),
NotifActionReceiver.java (decline call), build-apk.yml (permissions + rackgram:// deep link).

Supabase (already applied to project rjdcajjtfchyfvsfmohp): calls tables, groups tables, messages.video_url/client_id/expires_at,
chat_timers, profiles.hide_ls, chat-media bucket (audio/video, 50 MB), triggers for call + group push, groups.description/avatar_url/can_send/can_media/can_react, group_reactions table (permissions enforced by RLS).
Edge functions (already deployed): send-call-push (new), send-push (group branch), notif-action (decline_call).
Logo: icon-only.png / icon-foreground.png / icon-background.png and the in-app logo use the supplied picture (not cropped or zoomed).

v7: call screen buttons restyled (rounded squares + labels, line icons instead of emoji); startCall now sends status 'invited' for the callee explicitly.
v8: faster hang-up. endCall hides UI first, disconnects async, writes call+participant status in parallel, ends 1-1 call for both sides at once; other side also ends instantly from the realtime calls update (no longer waits for LiveKit).
v9: icon rebuilt from the supplied photo; foreground scaled so the logo shows at the same size as the photo on the user's phone (measured from screenshot).
v10: fixed New group / Edit profile layout (CSS class clash: story editor toolbar used .set, same as the form container; toolbar renamed to .sett).
v11: New group / New channel screen now has a photo picker (Add / Change / Remove photo); the photo uploads right after the group is created.
v12: New group/channel sizes applied from the user's tuner values (title 18, side pad 17, label 16, box 47/16/11, gap 12, tab 50/14/14, photo 92, top gap 15).
v13: Chat Settings screen (Settings > Chat Settings: text size, bubble corners, wallpaper incl. gallery, bubble + name colour, System/Night/Day, Enter-sends, swipe-reply, double-tap heart, autoplay videos, reset), drafts (saved per chat, shown in chat list), Delete account (edge function delete-account, type DELETE to confirm). Delete for everyone already existed (delete removes for both sides). Not included: report user (postponed), link preview, missed-call notification, mute-aware push.
v14: smooth open animations (screens fade/slide in, bottom sheets slide up, menus pop, call screens fade, button press feedback, no tap flash).
v15: all user-facing text is English (fixed 'Sahi email daalo', preview text, push 'Naya message'); send-push redeployed.
v16: usernames are unique across people, groups and channels (DB triggers + live 'Username unavailable' check in signup, Edit profile and New group/channel).
