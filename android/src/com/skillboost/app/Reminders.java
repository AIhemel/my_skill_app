package com.skillboost.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import java.util.Calendar;
import java.util.Random;

/** Schedules and shows the once-a-day study reminder. */
final class Reminders {
    static final String PREFS = "skillboost";
    private static final String CHANNEL = "daily";
    private static final int ALARM_ID = 1001;

    private static final String[] MESSAGES = {
        "Ten new words are waiting for you. Five minutes is enough.",
        "Your streak misses you. One tiny lesson keeps it alive.",
        "Today's embedded lesson is ready. Let's flip some bits.",
        "Small steps every day beat big steps once a week.",
        "Future you (GRE done, firmware engineer) says thanks.",
        "Take a breath, then take one small step. You've got this.",
    };

    private Reminders() {
    }

    static void schedule(Context c) {
        SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        Intent i = new Intent(c, ReminderReceiver.class);
        PendingIntent pi = PendingIntent.getBroadcast(c, ALARM_ID, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        am.cancel(pi);
        if (!p.getBoolean("on", false)) return;

        Calendar at = Calendar.getInstance();
        at.set(Calendar.HOUR_OF_DAY, p.getInt("hour", 20));
        at.set(Calendar.MINUTE, p.getInt("minute", 0));
        at.set(Calendar.SECOND, 0);
        at.set(Calendar.MILLISECOND, 0);
        if (at.getTimeInMillis() <= System.currentTimeMillis()) {
            at.add(Calendar.DAY_OF_YEAR, 1);
        }
        am.setInexactRepeating(AlarmManager.RTC_WAKEUP, at.getTimeInMillis(), AlarmManager.INTERVAL_DAY, pi);
    }

    static void show(Context c) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL,
                    c.getString(R.string.channel_name), NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription(c.getString(R.string.channel_desc));
            nm.createNotificationChannel(ch);
            b = new Notification.Builder(c, CHANNEL);
        } else {
            b = new Notification.Builder(c);
        }
        Intent open = new Intent(c, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String msg = MESSAGES[new Random().nextInt(MESSAGES.length)];
        b.setSmallIcon(R.drawable.ic_stat_notify)
                .setContentTitle("SkillBoost")
                .setContentText(msg)
                .setStyle(new Notification.BigTextStyle().bigText(msg))
                .setAutoCancel(true)
                .setContentIntent(pi);
        try {
            nm.notify(1, b.build());
        } catch (SecurityException ignored) {
            // Notification permission was denied; nothing to do.
        }
    }
}
