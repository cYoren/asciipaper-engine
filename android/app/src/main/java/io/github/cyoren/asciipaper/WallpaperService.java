package io.github.cyoren.asciipaper;

import android.content.Context;
import android.content.SharedPreferences;
import android.opengl.GLSurfaceView;
import android.util.Log;
import android.view.MotionEvent;
import android.view.SurfaceHolder;

// Live wallpaper and app preview share the same frame/energy policy and saved look.
public class WallpaperService extends android.service.wallpaper.WallpaperService {
    static final String PREFS = "asciipaper", WALLPAPER = "wallpaper", STYLE = "style";
    static final String DEFAULT_WALLPAPER = "synthwave", DEFAULT_STYLE = "characters";

    static String editsKey(SharedPreferences p) {
        return "look:" + p.getString(WALLPAPER, DEFAULT_WALLPAPER) + ":" + p.getString(STYLE, DEFAULT_STYLE);
    }

    static org.json.JSONObject chosenSpec(Context context) throws Exception {
        SharedPreferences p = context.getSharedPreferences(PREFS, MODE_PRIVATE);
        if (p.contains("project")) return new org.json.JSONObject(p.getString("project", "{}"));
        return Look.spec(context.getAssets(), p.getString(WALLPAPER, DEFAULT_WALLPAPER), p.getString(STYLE, DEFAULT_STYLE),
                new org.json.JSONObject(p.getString(editsKey(p), "{}")));
    }

    static Look chosen(Context context) throws Exception {
        return Look.fromSpec(context.getAssets(), chosenSpec(context));
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
        private FramePacer pacer;

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
            pacer = new FramePacer(WallpaperService.this, view, renderer);
            pacer.configure(getSharedPreferences(PREFS, MODE_PRIVATE));
            renderer.pointerStrength = getSharedPreferences(PREFS, MODE_PRIVATE).getFloat("pointer", 1);
            renderer.speed = getSharedPreferences(PREFS, MODE_PRIVATE).getFloat("speed", 1);
            getSharedPreferences(PREFS, MODE_PRIVATE).registerOnSharedPreferenceChangeListener(this);
        }

        @Override public void onVisibilityChanged(boolean visible) {
            if (view == null) return;
            if (visible) { view.onResume(); pacer.start(); } else { pacer.stop(); view.onPause(); }
        }

        @Override public void onTouchEvent(MotionEvent e) {
            if (renderer == null || view == null) return;
            int action = e.getActionMasked();
            renderer.touch(e.getX() / Math.max(1, renderer.surfaceWidth), e.getY() / Math.max(1, renderer.surfaceHeight),
                    action == MotionEvent.ACTION_DOWN || action == MotionEvent.ACTION_MOVE);
            pacer.touch();
        }

        @Override public void onSharedPreferenceChanged(SharedPreferences prefs, String key) {
            if (pacer == null) return;
            if (key.equals("fps") || key.equals("idleFps") || key.equals("pointer") || key.equals("speed") || key.equals("paused") || key.equals("clicks") || key.equals("quality")) {
                pacer.configure(prefs);
                renderer.pointerStrength = prefs.getFloat("pointer", 1); renderer.speed = prefs.getFloat("speed", 1);
                return;
            }
            try { renderer.setLook(chosen(WallpaperService.this)); pacer.refresh(); }
            catch (Exception e) { Log.e("asciipaper", "can't load", e); }
        }

        @Override public void onDestroy() {
            if (pacer != null) pacer.destroy();
            if (view != null && renderer != null) view.queueEvent(renderer::dispose);
            getSharedPreferences(PREFS, MODE_PRIVATE).unregisterOnSharedPreferenceChangeListener(this);
            if (view != null) view.destroy();
            super.onDestroy();
        }

        @Override protected void dump(String prefix, java.io.FileDescriptor fd, java.io.PrintWriter out, String[] args) {
            super.dump(prefix, fd, out, args);
            if (renderer != null && pacer != null)
                out.println(prefix + "asciipaper frames=" + renderer.frameCount + " " + pacer.diagnostics() + " mediaFrames=" + renderer.mediaFrames() + " render=" + renderer.renderSize());
        }
    }
}
