// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

package com.owaiskhan.converter.core

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
// `R` is generated into the module's namespace, which is the applicationId — not
// into this file's own Kotlin package. The two are deliberately different.
import com.owaiskhan.kitefold.R
import com.owaiskhan.converter.theme.Tokens
import java.util.concurrent.atomic.AtomicLong

/**
 * Keeps a batch alive while the app is in the background.
 *
 * This is the Android half of a guarantee iOS gets from `beginBackgroundTask`. Without
 * it, Android suspends the process shortly after the user switches away and a
 * long batch simply stops — which people read as the app having lost their work.
 *
 * A foreground service is the only mechanism that grants that reprieve, and Android
 * requires one to post a notification. That notification is not a nag: it is the
 * running job, with the count, the file being worked on, and a cancel button that works
 * without reopening the app.
 *
 * If the notification permission is refused, none of this stops working. The service
 * still runs and the batch still finishes — Android simply does not display the
 * notification, and the job appears in the active-apps list instead. The permission
 * buys visibility, not capability.
 */
public class ConversionService : Service() {

    private val lock = Any()
    private var jobId: String = ""
    private var totalCount: Int = 0
    private var completedCount: Int = 0
    private var displayName: String = ""
    private var cancelling: Boolean = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val incomingJobId = intent?.getStringExtra(EXTRA_JOB_ID).orEmpty()

        instance = this
        createChannel()

        if (intent?.action == ACTION_CANCEL) {
            synchronized(lock) {
                jobId = incomingJobId
                cancelling = true
            }
            // Repainted first: a cancel that takes a few seconds to drain should look
            // like it was received the moment it was tapped.
            render()
            // Stood down from here rather than from the queue, because a cancel tapped
            // after the process was rebuilt reaches a queue that no longer holds the job
            // and would otherwise leave this service running with nothing to do.
            JobQueue.cancel(incomingJobId) {
                activeJobId = null
                shutdown()
            }
            return START_NOT_STICKY
        }

        synchronized(lock) {
            jobId = incomingJobId
            totalCount = intent?.getIntExtra(EXTRA_TOTAL, 0) ?: 0
            completedCount = 0
            displayName = ""
            cancelling = false
        }

        // Claimed before any decision to stand down: Android kills a process that calls
        // `startForegroundService` and does not follow through within five seconds.
        startInForeground()

        // The job finished while this service was still starting, or the intent was not
        // ours to begin with.
        if (incomingJobId.isEmpty() || activeJobId != incomingJobId) {
            shutdown()
        }

        // Deliberately not sticky. The queue's state lives in memory, so a process the
        // system rebuilt would restore a notification for a batch that no longer exists.
        return START_NOT_STICKY
    }

    /**
     * Swiping the app out of recents is not the same as tapping Cancel, but it is the
     * closest thing Android offers to an intention to stop. Carrying on would leave a
     * batch converting with no notification the user kept and no screen to return to —
     * the JavaScript state that knows about this job dies with the task. Partial output
     * is deleted by the queue's own cancellation path.
     *
     * This callback only arrives because the service is declared `stopWithTask="false"`.
     * Declaring it true would have the system stop the service without telling it, which
     * is the version that leaves the queue running blind.
     */
    override fun onTaskRemoved(rootIntent: Intent?) {
        val current = activeJobId
        if (current != null) {
            activeJobId = null
            JobQueue.cancel(current) {}
        }
        shutdown()
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        super.onDestroy()
    }

    // ------------------------------------------------------------------ rendering --

    private fun createChannel() {
        val manager = getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return

        // IMPORTANCE_LOW: visible and silent. A conversion the user started themselves
        // has no business making a sound.
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.conversion_channel_name),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = getString(R.string.conversion_channel_description)
            setShowBadge(false)
            enableVibration(false)
        }
        manager.createNotificationChannel(channel)
    }

    private fun startInForeground() {
        // `dataSync` is Android's category for on-device file processing. Declaring the
        // type is mandatory from API 34 and ignored below API 29.
        ServiceCompat.startForeground(
            this,
            NOTIFICATION_ID,
            build(),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
        )
    }

    private fun render() {
        val manager = getSystemService(NotificationManager::class.java) ?: return
        // Throws nothing when the permission is absent; the post is simply dropped.
        manager.notify(NOTIFICATION_ID, build())
    }

    private fun build(): android.app.Notification {
        val snapshot = synchronized(lock) {
            Snapshot(jobId, totalCount, completedCount, displayName, cancelling)
        }

        val title = when {
            snapshot.cancelling -> getString(R.string.conversion_notification_cancelling)
            snapshot.total > 0 -> getString(
                R.string.conversion_notification_progress,
                minOf(snapshot.completed + 1, snapshot.total),
                snapshot.total,
            )
            else -> getString(R.string.conversion_notification_preparing)
        }

        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_converter)
            .setColor(ACCENT_COLOR)
            .setContentTitle(title)
            .setContentText(snapshot.displayName)
            .setOngoing(true)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            // The batch is the user's own file names. Nothing here belongs on a lock
            // screen that anyone walking past can read.
            .setVisibility(NotificationCompat.VISIBILITY_SECRET)
            // Without this the shade waits ten seconds before showing anything, which
            // is longer than most batches take.
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setProgress(
                maxOf(snapshot.total, 1),
                snapshot.completed,
                snapshot.cancelling || snapshot.total == 0,
            )

        contentIntent()?.let(builder::setContentIntent)

        if (!snapshot.cancelling) {
            builder.addAction(
                NotificationCompat.Action.Builder(
                    0,
                    getString(R.string.conversion_notification_cancel),
                    cancelIntent(snapshot.jobId),
                ).build(),
            )
        }

        return builder.build()
    }

    /** Tapping the notification returns to the app rather than launching a second copy. */
    private fun contentIntent(): PendingIntent? {
        val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return null
        launch.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        return PendingIntent.getActivity(this, 0, launch, PENDING_INTENT_FLAGS)
    }

    private fun cancelIntent(forJobId: String): PendingIntent {
        val intent = Intent(this, ConversionService::class.java).apply {
            action = ACTION_CANCEL
            putExtra(EXTRA_JOB_ID, forJobId)
        }
        return PendingIntent.getService(this, 1, intent, PENDING_INTENT_FLAGS)
    }

    private fun shutdown() {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private data class Snapshot(
        val jobId: String,
        val total: Int,
        val completed: Int,
        val displayName: String,
        val cancelling: Boolean,
    )

    // -------------------------------------------------------------------- control --

    public companion object {
        private const val CHANNEL_ID: String = "conversion-progress"

        /** Any non-zero id; a foreground service may not use zero. */
        private const val NOTIFICATION_ID: Int = 0xC0DE

        private const val ACTION_CANCEL: String = "com.owaiskhan.converter.action.CANCEL"
        private const val EXTRA_JOB_ID: String = "jobId"
        private const val EXTRA_TOTAL: String = "totalCount"

        /**
         * `FLAG_IMMUTABLE` is mandatory from API 31 and correct everywhere: nothing that
         * receives this intent has any business rewriting which job it cancels.
         */
        private const val PENDING_INTENT_FLAGS: Int =
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

        /**
         * Read from the generated design tokens rather than written here, so the shade
         * tints to the same accent as the app. Notifications have no dark variant to
         * choose between — Android tints the icon against its own surface — so the light
         * accent is the right one at both settings.
         */
        private val ACCENT_COLOR: Int = Tokens.LIGHT.accentFill.toInt()

        /**
         * Android throttles an app that redraws a notification in a tight loop, and a
         * progress bar updated ten times a second reads no differently from one updated
         * twice. The queue's own 10 Hz stream is thinned to this before it reaches the
         * shade.
         */
        private const val UPDATE_INTERVAL_MS: Long = 500L

        @Volatile
        private var instance: ConversionService? = null

        /**
         * The job the notification belongs to. Set before the service starts, so a job
         * that finishes during those few milliseconds can tell the service, on arrival,
         * that it is already obsolete.
         */
        @Volatile
        private var activeJobId: String? = null

        private val lastUpdate = AtomicLong(0)

        /**
         * Claims the foreground for a job. Safe to call when a service is already
         * running: the notification is taken over rather than duplicated.
         */
        @JvmStatic
        public fun start(context: Context, jobId: String, totalCount: Int) {
            activeJobId = jobId
            lastUpdate.set(0)

            val intent = Intent(context, ConversionService::class.java).apply {
                putExtra(EXTRA_JOB_ID, jobId)
                putExtra(EXTRA_TOTAL, totalCount)
            }

            try {
                ContextCompat.startForegroundService(context, intent)
            } catch (error: Throwable) {
                // From API 31 a foreground service may not be started while the app is
                // already in the background. A batch the user just started never hits
                // this; one handed over by a share target the system had already
                // backgrounded can. Losing the reprieve is a far better outcome than
                // crashing, and the conversion still runs while the app is on screen.
                activeJobId = null
            }
        }

        /** Throttled internally, so the queue may call this as often as it likes. */
        @JvmStatic
        public fun update(jobId: String, completed: Int, total: Int, displayName: String) {
            if (activeJobId != jobId) return

            val now = System.currentTimeMillis()
            val previous = lastUpdate.get()
            if (now - previous < UPDATE_INTERVAL_MS) return
            if (!lastUpdate.compareAndSet(previous, now)) return

            val service = instance ?: return
            synchronized(service.lock) {
                service.completedCount = completed
                service.totalCount = total
                service.displayName = displayName
            }
            service.render()
        }

        /**
         * Releases the foreground, but only for the job that holds it. A batch that
         * finishes after a second one has taken over must not remove the second one's
         * notification.
         */
        @JvmStatic
        public fun stop(jobId: String) {
            if (activeJobId != jobId) return
            activeJobId = null
            // Null while the service is still starting. `onStartCommand` compares the
            // intent's job id against `activeJobId` and stands itself down.
            instance?.shutdown()
        }
    }
}
