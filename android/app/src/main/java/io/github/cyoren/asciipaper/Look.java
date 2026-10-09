package io.github.cyoren.asciipaper;

import android.content.res.AssetManager;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

// A wallpaper ready to draw: a built-in shader wallpaper (wallpapers/specs/NAME.json) with a style from
// wallpapers/lib/looks.json applied, as `asciipaper look NAME STYLE` does on Linux.
final class Look {
    String glsl, scene, media, charset = " .:-=+*#%@", font;
    float cell = 8, aspect = .6f, maxCells = 40000, fill, time, period = (float) (2000 * Math.PI), shape, dither, interact, interactStrength = 1, interactRadius = .25f, pace = 1;
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
        return fromSpec(assets, spec(assets, name, style, null));
    }

    // Edits use the desktop spec's fields. Style defaults are applied before the
    // user's overrides, so fine controls do not get reset on every frame/reload.
    static JSONObject spec(AssetManager assets, String name, String style, JSONObject edits) throws IOException, JSONException {
        JSONObject spec;
        if (java.util.Arrays.asList("fluid","flow","matrix","yin-yang").contains(name)) {
            try { spec = NativeScene.spec(name); } catch (Exception e) { throw new IOException(e); }
        } else spec = new JSONObject(read(assets, "specs/" + name + ".json"));
        JSONObject looks = looks(assets);
        if (style != null && looks.getJSONObject("styles").has(style)) {   // a style resets shape, dither, palette, effects
            JSONObject s = looks.getJSONObject("styles").getJSONObject(style);
            for (String key : new String[]{"shape", "dither", "palette", "effects"}) spec.remove(key);
            for (Iterator<String> keys = s.keys(); keys.hasNext(); ) {
                String key = keys.next();
                if (key.equals("uniforms")) {
                    JSONObject uniforms = spec.optJSONObject("uniforms");
                    if (uniforms == null) uniforms = new JSONObject();
                    merge(uniforms, s.getJSONObject(key));
                    spec.put("uniforms", uniforms);
                }
                else if (!key.equals("about")) spec.put(key, s.get(key));
            }
        }
        if (edits != null) {
            JSONObject overrides = new JSONObject(edits.toString());
            JSONObject uniforms = spec.optJSONObject("uniforms");
            if (uniforms == null) uniforms = new JSONObject();
            merge(uniforms, overrides.optJSONObject("uniforms"));
            overrides.remove("uniforms");
            merge(spec, overrides);
            spec.put("uniforms", uniforms);
        }
        return spec;
    }

    static final String[] LOOK_KEYS = {"charset", "cell", "aspect", "maxCells", "background", "font", "fill", "weight",
            "shape", "dither", "palette", "effects", "uniforms"};

    // Normalize desktop look codes before persisting them. As on Windows, pasting
    // applies the look to the current scene; an embedded shader is not executed.
    static JSONObject recipeEdits(AssetManager assets, JSONObject recipe) throws IOException, JSONException {
        JSONObject catalog = looks(assets), edits = new JSONObject();
        edits.put("shape", "glyph"); edits.put("dither", "none");
        edits.put("palette", new JSONArray()); edits.put("effects", new JSONObject());
        for (String key : LOOK_KEYS) if (recipe.has(key)) edits.put(key, recipe.get(key));
        for (String key : new String[]{"shape", "dither"}) {
            String value = edits.getString(key);
            if (key.equals("dither") && names(catalog.getJSONArray("diffusion")).contains(value)) value = "blueNoise";
            if (!names(catalog.getJSONArray(key.equals("shape") ? "shapes" : "dithers")).contains(value))
                throw new JSONException("Unknown " + key + ": " + value);
            edits.put(key, value);
        }
        if (edits.has("charset")) {
            String charset = edits.getString("charset");
            if (catalog.getJSONObject("charsets").has(charset)) charset = catalog.getJSONObject("charsets").getString(charset);
            if (charset.isEmpty() || charset.codePointCount(0, charset.length()) > 256) throw new JSONException("Use 1 to 256 characters");
            edits.put("charset", charset);
        }
        for (String key : new String[]{"cell", "aspect", "maxCells", "fill", "weight"}) {
            if (!edits.has(key)) continue;
            double value = edits.getDouble(key);
            double min = key.equals("cell") ? 1 : key.equals("aspect") ? .1 : key.equals("maxCells") ? 1 : 0;
            double max = key.equals("cell") ? 128 : key.equals("aspect") ? 4 : key.equals("maxCells") ? 100000 : key.equals("weight") ? 900 : 1;
            if (!Double.isFinite(value) || value < min || value > max) throw new JSONException("Invalid " + key);
        }
        if (edits.has("background") && !edits.getString("background").matches("#[0-9a-fA-F]{6}"))
            throw new JSONException("Background must be #rrggbb");
        Object palette = edits.get("palette");
        if (palette instanceof String) {
            palette = palette.equals("original") ? new JSONArray() : catalog.getJSONObject("palettes").getJSONArray((String) palette);
            edits.put("palette", palette);
        }
        if (!(palette instanceof JSONArray) || ((JSONArray) palette).length() > 16) throw new JSONException("Use up to 16 palette colours");
        for (int i = 0; i < ((JSONArray) palette).length(); i++)
            if (!((JSONArray) palette).getString(i).matches("#[0-9a-fA-F]{6}")) throw new JSONException("Palette colours must be #rrggbb");
        JSONObject effects = edits.getJSONObject("effects"), ranges = catalog.getJSONObject("effects");
        for (String key : keys(effects)) {
            JSONArray range = ranges.getJSONArray(key);
            double value = effects.getDouble(key);
            if (!Double.isFinite(value)) throw new JSONException("Invalid effect " + key);
            effects.put(key, Math.max(range.getDouble(0), Math.min(range.getDouble(1), value)));
        }
        if (edits.has("uniforms")) edits.getJSONObject("uniforms");
        return edits;
    }

    static Look fromSpec(AssetManager assets, JSONObject spec) throws IOException, JSONException {
        JSONObject looks = looks(assets), uniforms = new JSONObject();
        String shader = spec.optString("shader", spec.has("media") ? "media" : "");
        Look look = new Look();
        look.glsl = shader.matches("(?s).*\\bcell\\s*\\(.*") ? shader : read(assets, shader.equals("media") ? "lib/media.glsl" : "specs/" + shader);
        look.scene = spec.optString("scene", "");
        look.media = spec.optString("mediaPath", "");
        if (look.glsl.startsWith("// defaults:")) merge(uniforms, new JSONObject(look.glsl.substring(12, look.glsl.indexOf('\n'))));
        merge(uniforms, spec.optJSONObject("uniforms"));
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
        look.shape = named(spec.opt("shape"), names(looks.getJSONArray("shapes")));
        look.dither = named(spec.opt("dither"), names(looks.getJSONArray("dithers")));
        look.pace = (float) Math.max(.05, Math.min(2, spec.optDouble("pace", 1)));
        Object interaction = spec.opt("interaction");   // "swirl" or {"mode": "swirl", "strength": 1, "radius": .25}
        JSONObject how = interaction instanceof JSONObject ? (JSONObject) interaction : new JSONObject().put("mode", interaction == null ? "none" : interaction);
        look.interact = named(how.opt("mode"), names(looks.getJSONArray("interactions")));
        look.interactStrength = (float) how.optDouble("strength", 1);
        look.interactRadius = (float) how.optDouble("radius", .25);
        Object palette = spec.opt("palette");
        if (palette instanceof String) palette = looks.getJSONObject("palettes").optJSONArray((String) palette);
        if (palette instanceof JSONArray) {
            JSONArray colors = (JSONArray) palette;
            look.palette = new float[Math.min(16, colors.length()) * 3];
            for (int i = 0; i < look.palette.length / 3; i++) System.arraycopy(color(colors.getString(i)), 0, look.palette, i * 3, 3);
        }
        JSONObject effects = spec.optJSONObject("effects");
        // JSONObject iteration order is not part of the shader ABI.
        List<String> fx = names(new JSONObject(read(assets, "lib/shaders/look-indices.json")).getJSONArray("FX"));
        for (int i = 0; effects != null && i < fx.size(); i++) look.effects[i] = (float) effects.optDouble(fx.get(i), 0);
        look.uniforms = uniforms;
        return look;
    }

    static List<String> names(JSONArray array) throws JSONException {
        List<String> names = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) names.add(array.getString(i));
        return names;
    }

    static List<String> keys(JSONObject object) {
        List<String> names = new ArrayList<>();
        for (Iterator<String> keys = object.keys(); keys.hasNext(); ) names.add(keys.next());
        return names;
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

    // Explicit GLSL assets, generated at development time; no runtime JS parsing.
    static String[] shaders(AssetManager assets) throws IOException {
        return new String[]{read(assets, "lib/shaders/header.glsl"), read(assets, "lib/shaders/quad.glsl"),
                read(assets, "lib/shaders/cell_main.glsl"), read(assets, "lib/shaders/glyphs.glsl")};
    }
}
