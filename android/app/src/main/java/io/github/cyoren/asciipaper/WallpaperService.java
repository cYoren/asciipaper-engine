package io.github.cyoren.asciipaper;

import android.content.Context;
import android.content.SharedPreferences;
import android.opengl.GLSurfaceView;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.MotionEvent;
import android.view.SurfaceHolder;

// The live wallpaper: a GLSurfaceView drawing into the wallpaper's surface, at 30 fps while visible and
// not at all while hidden. Follows the wallpaper and style chosen in the app.
public class WallpaperService extends android.service.wallpaper.WallpaperService {
    static final String PREFS = "asciipaper", WALLPAPER = "wallpaper", STYLE = "style";
    static final String DEFAULT_WALLPAPER = "synthwave", DEFAULT_STYLE = "characters";

    static Look chosen(Context context) throws Exception {
        SharedPreferences p = context.getSharedPreferences(PREFS, MODE_PRIVATE);
        return Look.load(context.getAssets(), p.getString(WALLPAPER, DEFAULT_WALLPAPER), p.getString(STYLE, DEFAULT_STYLE));
    }

    @Override public Engine onCreateEngine() { return new GLEngine(); }

    class GLEngine extends Engine implements SharedPreferences.OnSharedPreferenceChangeListener {
        private class View extends GLSurfaceView {
            View(Context context) { super(context); }
            @Override public SurfaceHolder getHolder() { return getSurfaceHolder(); }
            void destroy() { onDetachedFromWindow(); }
        }
        private View view;
        private Renderer renderer;
        private final Handler ticks = new Handler(Looper.getMainLooper());
        private final Runnable tick = new Runnable() {
            @Override public void run() { view.requestRender(); ticks.postDelayed(this, 33); }
        };

        @Override public void onCreate(SurfaceHolder holder) {
            super.onCreate(holder);
            setTouchEventsEnabled(true);
            try {
                renderer = new Renderer(Look.shaders(getAssets()), getResources().getDisplayMetrics().density, chosen(WallpaperService.this));
            } catch (Exception e) { Log.e("asciipaper", "can't load the wallpaper", e); return; }
            view = new View(WallpaperService.this);
            view.setEGLContextClientVersion(2);
            view.setPreserveEGLContextOnPause(true);
            view.setRenderer(renderer);
            view.setRenderMode(GLSurfaceView.RENDERMODE_WHEN_DIRTY);
            getSharedPreferences(PREFS, MODE_PRIVATE).registerOnSharedPreferenceChangeListener(this);
        }

        @Override public void onVisibilityChanged(boolean visible) {
            if (view == null) return;
            ticks.removeCallbacks(tick);
            if (visible) { view.onResume(); ticks.post(tick); } else view.onPause();
        }

        @Override public void onTouchEvent(MotionEvent e) {
            if (renderer == null) return;
            int action = e.getActionMasked();
            renderer.touch(e.getX() / Math.max(1, view.getWidth()), e.getY() / Math.max(1, view.getHeight()),
                    action == MotionEvent.ACTION_DOWN || action == MotionEvent.ACTION_MOVE);
        }

        @Override public void onSharedPreferenceChanged(SharedPreferences prefs, String key) {
            try { renderer.setLook(chosen(WallpaperService.this)); } catch (Exception e) { Log.e("asciipaper", "can't load", e); }
        }

        @Override public void onDestroy() {
            ticks.removeCallbacks(tick);
            getSharedPreferences(PREFS, MODE_PRIVATE).unregisterOnSharedPreferenceChangeListener(this);
            if (view != null) view.destroy();
            super.onDestroy();
        }
    }
}
