// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

package com.owaiskhan.converter.core

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/**
 * Whether a batch can show its progress while the app is in the background.
 *
 * This is the app's only runtime permission, and it is worth being precise about what
 * it does and does not buy. Background *conversion* comes from the foreground service
 * and needs no permission at all. What `POST_NOTIFICATIONS` buys is the user being able
 * to see how far the batch has got, and to cancel it, without reopening the app.
 * A refusal costs visibility, not work.
 *
 * Nothing here is asked for at launch. The request happens the first time the user
 * starts a batch large enough to plausibly outlive the screen, and never a second time.
 */
public object BackgroundProgress {

    /** Progress can be shown. */
    public const val GRANTED: String = "granted"

    /** Not granted, but the user has not been asked yet. */
    public const val DENIED: String = "denied"

    /** Refused, or switched off in Settings. Asking again would do nothing. */
    public const val BLOCKED: String = "blocked"

    private const val PREFERENCES: String = "converter.background-progress"
    private const val KEY_ASKED: String = "asked"

    @JvmStatic
    public fun status(context: Context): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            // Before Android 13 a notification needed no permission — but the user could
            // always switch notifications off for an app in Settings, and that is a
            // refusal too, just an older one.
            return if (NotificationManagerCompat.from(context).areNotificationsEnabled()) {
                GRANTED
            } else {
                BLOCKED
            }
        }

        val held = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED

        if (held) return GRANTED

        // `shouldShowRequestPermissionRationale` returns false both before the first ask
        // and after a final refusal, so it cannot tell them apart. That one bit is
        // remembered here instead. It is the only thing this app persists about
        // permissions and it describes the app's own behaviour, not the user.
        return if (hasAsked(context)) BLOCKED else DENIED
    }

    @JvmStatic
    public fun hasAsked(context: Context): Boolean =
        preferences(context).getBoolean(KEY_ASKED, false)

    @JvmStatic
    public fun markAsked(context: Context) {
        preferences(context).edit().putBoolean(KEY_ASKED, true).apply()
    }

    private fun preferences(context: Context) =
        context.applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
}
