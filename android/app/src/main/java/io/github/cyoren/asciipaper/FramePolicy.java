package io.github.cyoren.asciipaper;

// Pure policy shared by the preview and wallpaper. Keep Android APIs in FramePacer
// so frame limits and power/thermal transitions can be tested without a device.
final class FramePolicy {
    static final int DEFAULT_FPS = 24, DEFAULT_IDLE_FPS = 12;
    static final long ACTIVE_MILLIS = 2000;
    final int fps, idleFps;

    FramePolicy(int fps, int idleFps) {
        this.fps = Math.max(1, Math.min(60, fps));
        this.idleFps = Math.max(1, Math.min(this.fps, idleFps));
    }

    int rate(long now, long lastInput, boolean powerSave, int thermalStatus) {
        boolean active = now - lastInput < ACTIVE_MILLIS;
        int rate = active ? fps : idleFps;
        if (powerSave) rate = Math.min(rate, active ? 12 : 6);
        // Android's thermal constants: MODERATE=2, SEVERE=3, CRITICAL=4.
        if (thermalStatus >= 4) rate = Math.min(rate, 1);
        else if (thermalStatus >= 3) rate = Math.min(rate, 6);
        else if (thermalStatus >= 2) rate = Math.min(rate, active ? 12 : 6);
        return rate;
    }

    long delay(long now, long lastInput, boolean powerSave, int thermalStatus) {
        int rate = rate(now, lastInput, powerSave, thermalStatus);
        return (1000L + rate - 1) / rate;
    }
}
