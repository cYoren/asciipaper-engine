package io.github.cyoren.asciipaper;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.opengl.GLSurfaceView;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.view.SurfaceHolder;

// Main-thread lifecycle adapter. No rendering timer is left running when hidden,
// the screen is off, or the GL surface has been destroyed.
final class FramePacer implements SurfaceHolder.Callback {
    private final Context context;
    private final GLSurfaceView view;
    private final Renderer renderer;
    private final PowerManager power;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private FramePolicy policy = new FramePolicy(FramePolicy.DEFAULT_FPS, FramePolicy.DEFAULT_IDLE_FPS);
    private boolean started, surfaceReady, powerSave, userPaused;
    private int thermalStatus;
    private long lastInput = -100000;
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (!canDraw()) return;
            view.requestRender();
            handler.postDelayed(this, policy.delay(SystemClock.uptimeMillis(), lastInput, powerSave, thermalStatus));
        }
    };
    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            powerSave = power.isPowerSaveMode();
            if (Intent.ACTION_SCREEN_ON.equals(intent.getAction())) renderer.resetClock();
            reschedule();
        }
    };
    private PowerManager.OnThermalStatusChangedListener thermalListener;

    FramePacer(Context context, GLSurfaceView view, Renderer renderer) {
        this.context = context;
        this.view = view;
        this.renderer = renderer;
        power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        view.setRenderMode(GLSurfaceView.RENDERMODE_WHEN_DIRTY);
        SurfaceHolder holder = view.getHolder();
        surfaceReady = holder.getSurface() != null && holder.getSurface().isValid();
        holder.addCallback(this);
    }

    void configure(SharedPreferences prefs) {
        userPaused=prefs.getBoolean("paused",false);
        renderer.clicksEnabled=prefs.getBoolean("clicks",false);
        policy = new FramePolicy(prefs.getInt("fps", FramePolicy.DEFAULT_FPS),
                prefs.getInt("idleFps", FramePolicy.DEFAULT_IDLE_FPS));
        reschedule();
    }

    void start() {
        if (started) return;
        started = true;
        renderer.resetClock();
        powerSave = power.isPowerSaveMode();
        IntentFilter filter = new IntentFilter(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED);
        filter.addAction(Intent.ACTION_SCREEN_OFF);
        filter.addAction(Intent.ACTION_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 33) context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
        else context.registerReceiver(receiver, filter);
        if (Build.VERSION.SDK_INT >= 29) {
            thermalStatus = power.getCurrentThermalStatus();
            thermalListener = status -> { thermalStatus = status; reschedule(); };
            power.addThermalStatusListener(thermalListener);
        }
        reschedule();
    }

    void stop() {
        if (!started) return;
        started = false;
        handler.removeCallbacks(tick);
        renderer.setActive(false);
        context.unregisterReceiver(receiver);
        if (Build.VERSION.SDK_INT >= 29 && thermalListener != null) {
            power.removeThermalStatusListener(thermalListener);
            thermalListener = null;
        }
    }

    void destroy() { stop(); view.getHolder().removeCallback(this); }

    void touch() {
        long now = SystemClock.uptimeMillis();
        boolean wasIdle = now - lastInput >= FramePolicy.ACTIVE_MILLIS;
        lastInput = now;
        if (wasIdle) reschedule();
    }

    void refresh() { reschedule(); }

    String diagnostics() {
        return "drawing=" + canDraw() + " fps=" + policy.rate(SystemClock.uptimeMillis(), lastInput, powerSave, thermalStatus)
                + " powerSave=" + powerSave + " thermal=" + thermalStatus;
    }

    private boolean canDraw() { return started && surfaceReady && !userPaused && power.isInteractive(); }

    private void reschedule() {
        handler.removeCallbacks(tick);
        renderer.setActive(canDraw());
        if (canDraw()) handler.post(tick);
    }

    @Override public void surfaceCreated(SurfaceHolder holder) { surfaceReady = true; reschedule(); }
    @Override public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) { reschedule(); }
    @Override public void surfaceDestroyed(SurfaceHolder holder) { surfaceReady = false; handler.removeCallbacks(tick); renderer.setActive(false); }
}
