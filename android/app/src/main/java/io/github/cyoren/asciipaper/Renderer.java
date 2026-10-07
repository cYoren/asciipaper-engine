package io.github.cyoren.asciipaper;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.opengl.GLES20;
import android.opengl.GLSurfaceView;
import android.opengl.GLUtils;
import android.os.SystemClock;
import android.util.Log;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;
import org.json.JSONArray;

// The two-pass renderer of lib/asciipaper.js: pass 1 runs the wallpaper's cell() once per character cell
// into a cols x rows texture, pass 2 draws each cell as a glyph (or a shape) with the post effects.
final class Renderer implements GLSurfaceView.Renderer {
    private static final int PAD = 3;
    private final String[] shaders;   // HEADER, QUAD, CELL_MAIN, GLYPHS
    private final float density;
    private Look look, pending;
    private int cellProg, glyphProg, fbo, cellsTex, atlasTex;
    private int width, height, cols, rows, tile, atlasW, atlasH;
    private float cw, ch, time;
    private long previous;
    private boolean ready;
    private final FloatBuffer quad = ByteBuffer.allocateDirect(32).order(ByteOrder.nativeOrder()).asFloatBuffer().put(new float[]{0, 0, 1, 0, 0, 1, 1, 1});
    private final Map<String, Integer> locations = new HashMap<>();
    // Pointer, 0..1 from the top left (written from the UI thread).
    volatile float px = .5f, py = .5f, vx, vy;
    volatile boolean down;
    volatile long moved = -100000;

    Renderer(String[] shaders, float density, Look look) { this.shaders = shaders; this.density = density; this.pending = look; }

    void setLook(Look next) { pending = next; }

    void touch(float x, float y, boolean pressed) {
        long now = SystemClock.uptimeMillis();
        float dt = Math.max(.001f, (now - moved) / 1000f);
        if (dt < .25f) { vx += ((x - px) / dt - vx) * .5f; vy += ((y - py) / dt - vy) * .5f; }
        px = x; py = y; down = pressed; moved = now;
        if (!pressed) { vx = vy = 0; }
    }

    @Override public void onSurfaceCreated(GL10 unused, EGLConfig config) {
        ready = false;   // a new context: everything is rebuilt
        cellProg = glyphProg = 0;
        locations.clear();
        if (pending == null) pending = look;
        int[] ids = new int[2];
        GLES20.glGenTextures(2, ids, 0); cellsTex = ids[0]; atlasTex = ids[1];
        GLES20.glGenFramebuffers(1, ids, 0); fbo = ids[0];
        for (int t : new int[]{cellsTex, atlasTex}) {
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, t);
            int filter = t == cellsTex ? GLES20.GL_NEAREST : GLES20.GL_LINEAR;
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, filter);
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, filter);
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE);
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE);
        }
        GLES20.glPixelStorei(GLES20.GL_UNPACK_ALIGNMENT, 1);
    }

    @Override public void onSurfaceChanged(GL10 unused, int w, int h) {
        width = w; height = h;
        if (look != null && pending == null) pending = look;   // re-layout the grid and atlas
    }

    @Override public void onDrawFrame(GL10 unused) {
        if (pending != null && width > 0) {
            Look next = pending;
            pending = null;
            try { use(next); } catch (RuntimeException e) { Log.e("asciipaper", "can't draw this look", e); }
        }
        if (!ready) { GLES20.glClearColor(0, 0, 0, 1); GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT); return; }
        long now = SystemClock.uptimeMillis();
        float dt = previous == 0 ? 1 / 60f : Math.min(.1f, (now - previous) / 1000f);
        previous = now;
        time = look.time + (time - look.time + dt) % look.period;
        float W = width / density, H = height / density;

        GLES20.glUseProgram(cellProg);
        u(cellProg, "u_time", time); u2(cellProg, "u_grid", cols, rows); u2(cellProg, "u_size", W, H);
        u(cellProg, "u_aspect", W / H); u2(cellProg, "u_pointer", px, py); u2(cellProg, "u_velocity", vx, vy);
        u(cellProg, "u_down", down ? 1 : 0); u(cellProg, "u_strength", 1); u(cellProg, "u_idle", (now - moved) / 1000f);
        float[] clicks = new float[24];
        for (int i = 0; i < 8; i++) clicks[i * 3 + 2] = 1e4f;   // click ripples are off, as on the desktop
        GLES20.glUniform3fv(loc(cellProg, "u_clicks"), 8, clicks, 0);
        uniforms();
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0); GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, cellsTex);
        GLES20.glActiveTexture(GLES20.GL_TEXTURE1); GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, atlasTex);
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fbo);
        GLES20.glViewport(0, 0, cols, rows);
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4);
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0);
        GLES20.glViewport(0, 0, width, height);
        GLES20.glUseProgram(glyphProg);
        u(glyphProg, "time", time);
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4);
    }

    // Compile the look's programs and lay out its grid and glyph atlas for this surface.
    private void use(Look next) {
        int nextCell = program(shaders[0] + next.glsl + shaders[2]);
        if (nextCell == 0) return;   // keep drawing the old look
        if (glyphProg == 0) glyphProg = program(shaders[3]);
        if (cellProg != 0) GLES20.glDeleteProgram(cellProg);
        cellProg = nextCell;
        look = next;
        locations.clear();
        quad.position(0);
        GLES20.glEnableVertexAttribArray(0);
        GLES20.glVertexAttribPointer(0, 2, GLES20.GL_FLOAT, false, 0, quad);

        float W = width / density, H = height / density;
        float cellW = Math.max(look.cell, (float) Math.sqrt(W * H * look.aspect / look.maxCells));
        cols = Math.max(1, (int) Math.floor(W / cellW));
        rows = Math.max(1, (int) Math.floor(H * look.aspect / cellW));
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, cellsTex);
        GLES20.glTexImage2D(GLES20.GL_TEXTURE_2D, 0, GLES20.GL_RGBA, cols, rows, 0, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, null);
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fbo);
        GLES20.glFramebufferTexture2D(GLES20.GL_FRAMEBUFFER, GLES20.GL_COLOR_ATTACHMENT0, GLES20.GL_TEXTURE_2D, cellsTex, 0);
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0);
        buildAtlas();

        int glyphs = look.charset.codePointCount(0, look.charset.length());
        GLES20.glUseProgram(glyphProg);
        GLES20.glUniform1i(loc(glyphProg, "cells"), 0); GLES20.glUniform1i(loc(glyphProg, "atlas"), 1);
        GLES20.glUniform3fv(loc(glyphProg, "bg"), 1, look.background, 0);
        u(glyphProg, "fill", look.fill); u(glyphProg, "glyphs", glyphs); u(glyphProg, "shape", look.shape);
        GLES20.glUniform4fv(loc(glyphProg, "fxA"), 1, look.effects, 0);
        GLES20.glUniform4fv(loc(glyphProg, "fxB"), 1, look.effects, 4);
        GLES20.glUniform4fv(loc(glyphProg, "fxC"), 1, look.effects, 8);
        u2(glyphProg, "grid", cols, rows); u2(glyphProg, "cell", cw, ch); u2(glyphProg, "atlasSize", atlasW, atlasH);
        u(glyphProg, "tile", tile); u(glyphProg, "pad", PAD);
        GLES20.glUseProgram(cellProg);
        GLES20.glUniform1i(loc(cellProg, "u_data"), 2); GLES20.glUniform1i(loc(cellProg, "u_lut"), 3);
        u(cellProg, "u_glyphs", glyphs); u(cellProg, "u_useLut", 0);
        u(cellProg, "u_dither", look.dither); u(cellProg, "u_paletteSize", look.palette.length / 3f);
        if (look.palette.length > 0) GLES20.glUniform3fv(loc(cellProg, "u_palette"), look.palette.length / 3, look.palette, 0);
        ready = true;
    }

    // Glyphs rasterized at the exact cell size in device pixels, laid out as asciipaper.js does.
    private void buildAtlas() {
        cw = (float) width / cols; ch = (float) height / rows;
        int n = look.charset.codePointCount(0, look.charset.length());
        tile = (int) Math.ceil(cw) + PAD * 2;
        atlasW = tile * n; atlasH = (int) Math.ceil(ch) + PAD * 2;
        Bitmap bitmap = Bitmap.createBitmap(atlasW, atlasH, Bitmap.Config.ALPHA_8);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setTypeface(Typeface.create(Typeface.MONOSPACE, look.weight >= 600 ? Typeface.BOLD : Typeface.NORMAL));
        paint.setTextSize(.9f * Math.min(cw / .55f, ch));
        paint.setTextAlign(Paint.Align.CENTER);
        Paint.FontMetrics m = paint.getFontMetrics();
        Canvas canvas = new Canvas(bitmap);
        int i = 0;
        for (int at = 0; at < look.charset.length(); i++) {
            int cp = look.charset.codePointAt(at), next = at + Character.charCount(cp);
            canvas.drawText(look.charset, at, next, i * tile + PAD + cw / 2, PAD + ch / 2 - (m.ascent + m.descent) / 2, paint);
            at = next;
        }
        GLES20.glActiveTexture(GLES20.GL_TEXTURE1);
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, atlasTex);
        GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bitmap, 0);
        bitmap.recycle();
    }

    // The wallpaper's own uniforms: numbers, booleans, [x, y…] and "#rrggbb".
    private void uniforms() {
        for (Iterator<String> keys = look.uniforms.keys(); keys.hasNext(); ) {
            String key = keys.next();
            Object v = look.uniforms.opt(key);
            int at = loc(cellProg, key);
            if (at < 0) continue;
            if (v instanceof Number) GLES20.glUniform1f(at, ((Number) v).floatValue());
            else if (v instanceof Boolean) GLES20.glUniform1f(at, (Boolean) v ? 1 : 0);
            else if (v instanceof String) GLES20.glUniform3fv(at, 1, Look.color((String) v), 0);
            else if (v instanceof JSONArray) {
                JSONArray a = (JSONArray) v;
                float[] f = new float[Math.min(4, a.length())];
                for (int i = 0; i < f.length; i++) f[i] = (float) a.optDouble(i, 0);
                if (f.length == 2) GLES20.glUniform2fv(at, 1, f, 0);
                else if (f.length == 3) GLES20.glUniform3fv(at, 1, f, 0);
                else if (f.length == 4) GLES20.glUniform4fv(at, 1, f, 0);
            }
        }
    }

    private int loc(int prog, String name) {
        String key = prog + ":" + name;
        Integer at = locations.get(key);
        if (at == null) { at = GLES20.glGetUniformLocation(prog, name); locations.put(key, at); }
        return at;
    }
    private void u(int prog, String name, float v) { GLES20.glUniform1f(loc(prog, name), v); }
    private void u2(int prog, String name, float a, float b) { GLES20.glUniform2f(loc(prog, name), a, b); }

    private int program(String fragment) {
        int p = GLES20.glCreateProgram();
        int vs = shader(GLES20.GL_VERTEX_SHADER, shaders[1]), fs = shader(GLES20.GL_FRAGMENT_SHADER, fragment);
        if (vs == 0 || fs == 0) return 0;
        GLES20.glAttachShader(p, vs); GLES20.glAttachShader(p, fs);
        GLES20.glBindAttribLocation(p, 0, "p");
        GLES20.glLinkProgram(p);
        int[] ok = new int[1];
        GLES20.glGetProgramiv(p, GLES20.GL_LINK_STATUS, ok, 0);
        if (ok[0] == 0) { Log.e("asciipaper", "link: " + GLES20.glGetProgramInfoLog(p)); return 0; }
        return p;
    }

    private static int shader(int type, String code) {
        int s = GLES20.glCreateShader(type);
        GLES20.glShaderSource(s, code);
        GLES20.glCompileShader(s);
        int[] ok = new int[1];
        GLES20.glGetShaderiv(s, GLES20.GL_COMPILE_STATUS, ok, 0);
        if (ok[0] == 0) { Log.e("asciipaper", "shader: " + GLES20.glGetShaderInfoLog(s)); return 0; }
        return s;
    }
}
