package io.github.cyoren.asciipaper;

import android.content.res.AssetManager;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

// A wallpaper ready to draw: a built-in shader wallpaper (wallpapers/specs/NAME.json) with a style from
// wallpapers/lib/looks.json applied, as `asciipaper look NAME STYLE` does on Linux.
final class Look {
    // Look names, by index: the same tables as native/spec.c and lib/asciipaper.js.
    static final List<String> SHAPES = Arrays.asList("glyph", "pixel", "mosaic", "dots", "led", "lego", "cross", "diamond",
            "lines", "diagonal", "voxel", "disco", "cmyk");
    static final List<String> DITHERS = Arrays.asList("none", "bayer2", "bayer4", "bayer8", "bayer16", "halftone", "radial",
            "linesH", "linesV", "linesD", "whiteNoise", "blueNoise");
    static final List<String> FX = Arrays.asList("vignette", "scanlines", "crt", "rgbSplit", "grain", "glitch", "bloom", "dust",
            "saturation", "hue", "flicker");

    String glsl, charset = " .:-=+*#%@", font;
    float cell = 8, aspect = .6f, maxCells = 40000, fill, time, period = (float) (2000 * Math.PI), shape, dither;
    int weight;
    float[] background = {.03f, .035f, .035f}, palette = new float[0], effects = new float[12];
    JSONObject uniforms = new JSONObject();

    static String read(AssetManager assets, String path) throws IOException {
        try (InputStream in = assets.open(path)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[16384];
            for (int n; (n = in.read(buffer)) > 0; ) out.write(buffer, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }

    // The built-in shader wallpapers, by name.
    static List<String> wallpapers(AssetManager assets) throws IOException {
        List<String> names = new ArrayList<>();
        for (String file : assets.list("specs")) if (file.endsWith(".json")) names.add(file.substring(0, file.length() - 5));
        names.sort(null);
        return names;
    }

    static JSONObject looks(AssetManager assets) throws IOException, JSONException {
        return new JSONObject(read(assets, "lib/looks.json"));
    }

    static Look load(AssetManager assets, String name, String style) throws IOException, JSONException {
        JSONObject spec = new JSONObject(read(assets, "specs/" + name + ".json"));
        JSONObject looks = looks(assets), uniforms = new JSONObject();
        String shader = spec.getString("shader");
        Look look = new Look();
        look.glsl = shader.contains("cell(") ? shader : read(assets, "specs/" + shader);
        if (look.glsl.startsWith("// defaults:")) merge(uniforms, new JSONObject(look.glsl.substring(12, look.glsl.indexOf('\n'))));
        merge(uniforms, spec.optJSONObject("uniforms"));
        if (style != null && looks.getJSONObject("styles").has(style)) {   // a style resets shape, dither, palette, effects
            JSONObject s = looks.getJSONObject("styles").getJSONObject(style);
            for (String key : new String[]{"shape", "dither", "palette", "effects"}) spec.remove(key);
            for (Iterator<String> keys = s.keys(); keys.hasNext(); ) {
                String key = keys.next();
                if (key.equals("uniforms")) merge(uniforms, s.getJSONObject(key));
                else if (!key.equals("about")) spec.put(key, s.get(key));
            }
        }
        Object charset = spec.opt("charset");
        if (charset instanceof String) {
            JSONObject named = looks.getJSONObject("charsets");
            look.charset = named.has((String) charset) ? named.getString((String) charset) : (String) charset;
        }
        look.cell = (float) spec.optDouble("cell", 8);
        look.aspect = (float) spec.optDouble("aspect", .55);
        look.maxCells = (float) spec.optDouble("maxCells", 40000);
        look.fill = (float) spec.optDouble("fill", 0);
        look.weight = spec.optInt("weight", 400);
        look.time = (float) spec.optDouble("time", 0);
        if (spec.optDouble("period", 0) > 0) look.period = (float) spec.getDouble("period");
        look.background = color(spec.optString("background", "#000000"));
        look.shape = named(spec.opt("shape"), SHAPES);
        look.dither = named(spec.opt("dither"), DITHERS);
        Object palette = spec.opt("palette");
        if (palette instanceof String) palette = looks.getJSONObject("palettes").optJSONArray((String) palette);
        if (palette instanceof JSONArray) {
            JSONArray colors = (JSONArray) palette;
            look.palette = new float[Math.min(16, colors.length()) * 3];
            for (int i = 0; i < look.palette.length / 3; i++) System.arraycopy(color(colors.getString(i)), 0, look.palette, i * 3, 3);
        }
        JSONObject effects = spec.optJSONObject("effects");
        for (int i = 0; effects != null && i < FX.size(); i++) look.effects[i] = (float) effects.optDouble(FX.get(i), 0);
        look.uniforms = uniforms;
        return look;
    }

    static void merge(JSONObject into, JSONObject from) throws JSONException {
        if (from == null) return;
        for (Iterator<String> keys = from.keys(); keys.hasNext(); ) { String k = keys.next(); into.put(k, from.get(k)); }
    }

    static float named(Object value, List<String> names) {
        if (value instanceof Number) return ((Number) value).floatValue();
        return Math.max(0, names.indexOf(value));
    }

    static float[] color(String hex) {
        if (hex == null || !hex.matches("#[0-9a-fA-F]{6}")) return new float[]{0, 0, 0};
        float[] rgb = new float[3];
        for (int i = 0; i < 3; i++) rgb[i] = Integer.parseInt(hex.substring(1 + i * 2, 3 + i * 2), 16) / 255f;
        return rgb;
    }

    // "lego" → "Lego", "matrix-code" → "Matrix code"
    static String title(String name) {
        switch (name) {
            case "lego": return "LEGO";
            case "crt": return "CRT";
            case "cmyk": return "CMYK";
            case "led": return "LED";
            case "c64": return "C64";
            case "nes": return "NES";
            case "cga": return "CGA";
            case "pico8": return "PICO-8";
        }
        String spaced = name.replace('-', ' ');
        return spaced.substring(0, 1).toUpperCase(Locale.ROOT) + spaced.substring(1);
    }

    // The renderer's shaders, read from lib/asciipaper.js so all three renderers share one copy.
    static String[] shaders(AssetManager assets) throws IOException {
        String js = read(assets, "lib/asciipaper.js");
        return new String[]{part(js, "HEADER", '`'), part(js, "QUAD", '\''), part(js, "CELL_MAIN", '`'), part(js, "GLYPHS", '`')};
    }

    private static String part(String js, String name, char quote) {
        Matcher m = Pattern.compile("const " + name + " = " + quote + "([\\s\\S]*?)" + quote + ";").matcher(js);
        if (!m.find()) throw new IllegalStateException("asciipaper.js has no " + name);
        return m.group(1);
    }
}
