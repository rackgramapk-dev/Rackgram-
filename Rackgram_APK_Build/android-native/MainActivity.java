package com.rackgram.app;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

/** Replaces the generated MainActivity: the call screen may appear over the lock screen, the rest of the app never does. */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        lockScreenMode(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        lockScreenMode(intent);
    }

    @Override
    protected void onStop() {
        super.onStop();
        // user left the app while the phone is unlocked -> go back to normal behaviour
        KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        if (km == null || !km.isKeyguardLocked()) setOverLock(false);
    }

    private void lockScreenMode(Intent i) {
        boolean call = i != null && i.getData() != null
                && "rackgram".equals(i.getData().getScheme()) && "call".equals(i.getData().getHost());
        setOverLock(call);
    }

    private void setOverLock(boolean on) {
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(on);
            setTurnScreenOn(on);
        } else {
            int f = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON;
            if (on) getWindow().addFlags(f); else getWindow().clearFlags(f);
        }
    }
}
