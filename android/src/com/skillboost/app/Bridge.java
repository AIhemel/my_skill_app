package com.skillboost.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.speech.tts.TextToSpeech;
import android.webkit.JavascriptInterface;

/** Methods callable from JavaScript as window.AndroidBridge.*. */
public class Bridge {
    private final MainActivity activity;

    Bridge(MainActivity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public boolean isNative() {
        return true;
    }

    @JavascriptInterface
    public boolean canSpeak() {
        return activity.ttsReady;
    }

    @JavascriptInterface
    public void speak(String text) {
        if (activity.tts != null && activity.ttsReady) {
            activity.tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "sb");
        }
    }

    @JavascriptInterface
    public void vibrate(int ms) {
        try {
            Vibrator v = (Vibrator) activity.getSystemService(Context.VIBRATOR_SERVICE);
            if (v == null || !v.hasVibrator()) return;
            if (Build.VERSION.SDK_INT >= 26) {
                v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
            } else {
                v.vibrate(ms);
            }
        } catch (Exception ignored) {
            // Haptics are a nicety only.
        }
    }

    @JavascriptInterface
    public void share(String title, String text) {
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_SUBJECT, title);
        send.putExtra(Intent.EXTRA_TEXT, text);
        Intent chooser = Intent.createChooser(send, title);
        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        activity.startActivity(chooser);
    }

    @JavascriptInterface
    public void setSystemBars(String color, boolean lightBackground) {
        activity.setSystemBars(color, lightBackground);
    }

    /** Turn the daily reminder on/off. Asks for notification permission on Android 13+. */
    @JavascriptInterface
    public void setReminder(boolean enabled, int hour, int minute) {
        SharedPreferences p = activity.getSharedPreferences(Reminders.PREFS, Context.MODE_PRIVATE);
        p.edit().putBoolean("on", enabled).putInt("hour", hour).putInt("minute", minute).apply();
        if (enabled && Build.VERSION.SDK_INT >= 33
                && activity.checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                != PackageManager.PERMISSION_GRANTED) {
            activity.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    activity.requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 7);
                }
            });
        }
        Reminders.schedule(activity);
    }

    @JavascriptInterface
    public String getReminder() {
        SharedPreferences p = activity.getSharedPreferences(Reminders.PREFS, Context.MODE_PRIVATE);
        return "{\"on\":" + p.getBoolean("on", false)
                + ",\"hour\":" + p.getInt("hour", 20)
                + ",\"minute\":" + p.getInt("minute", 0) + "}";
    }

    @JavascriptInterface
    public void testReminder() {
        Reminders.show(activity);
    }

    /** Backup copy of the web app's progress, in case WebView storage is ever cleared. */
    @JavascriptInterface
    public void saveState(String json) {
        activity.getSharedPreferences(Reminders.PREFS, Context.MODE_PRIVATE)
                .edit().putString("state", json).apply();
    }

    @JavascriptInterface
    public String loadState() {
        return activity.getSharedPreferences(Reminders.PREFS, Context.MODE_PRIVATE).getString("state", "");
    }
}
