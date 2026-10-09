package io.github.cyoren.asciipaper;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.WallpaperManager;
import android.content.ComponentName;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.opengl.GLSurfaceView;
import android.os.Bundle;
import android.os.Build;
import android.view.MotionEvent;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

// Uses the desktop spec's fields and look catalog. Edits are saved per wallpaper/style.
public class MainActivity extends Activity implements SharedPreferences.OnSharedPreferenceChangeListener {
    private Preview preview;
    private Renderer renderer;
    private FramePacer pacer;
    private SharedPreferences prefs;
    private JSONObject catalog;
    private LinearLayout editor;

    private static final class Preview extends GLSurfaceView {
        Preview(android.content.Context context) { super(context); }
        @Override public boolean performClick() { super.performClick(); return true; }
    }

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences(WallpaperService.PREFS, MODE_PRIVATE);
        List<String> wallpapers, styles, styleLabels = new ArrayList<>();
        try {
            wallpapers = Look.wallpapers(getAssets());
            catalog = Look.looks(getAssets());
            JSONObject all = catalog.getJSONObject("styles");
            styles = Look.keys(all);
            for (String name : styles) styleLabels.add(Look.title(name) + ": " + all.getJSONObject(name).optString("about"));
            renderer = new Renderer(Look.shaders(getAssets()), getResources().getDisplayMetrics().density, WallpaperService.chosen(this));
        } catch (Exception e) { error(e); finish(); return; }

        preview = new Preview(this);
        preview.setEGLContextClientVersion(2);
        preview.setPreserveEGLContextOnPause(true);
        preview.setRenderer(renderer);
        pacer = new FramePacer(this, preview, renderer);
        configure();
        preview.setOnTouchListener((v, e) -> {
            int action = e.getActionMasked();
            renderer.touch(e.getX() / Math.max(1, v.getWidth()), e.getY() / Math.max(1, v.getHeight()),
                    action == MotionEvent.ACTION_DOWN || action == MotionEvent.ACTION_MOVE);
            pacer.touch();
            if (action == MotionEvent.ACTION_UP) v.performClick();
            return true;
        });

        LinearLayout controls = column();
        controls.setPadding(dp(16), dp(8), dp(16), dp(16));
        controls.setBackgroundColor(Color.rgb(12, 14, 14));
        controls.addView(label("Wallpaper"));
        controls.addView(choice(titles(wallpapers), wallpapers,
                prefs.getString(WallpaperService.WALLPAPER, WallpaperService.DEFAULT_WALLPAPER),
                value -> prefs.edit().putString(WallpaperService.WALLPAPER, value).apply()));
        controls.addView(label("Style"));
        controls.addView(choice(styleLabels, styles,
                prefs.getString(WallpaperService.STYLE, WallpaperService.DEFAULT_STYLE),
                value -> prefs.edit().putString(WallpaperService.STYLE, value).apply()));
        editor = column();
        controls.addView(editor);
        rebuildEditor();

        controls.addView(label("Performance"));
        controls.addView(label("Idle rate is capped by the active rate. Battery saver and heat lower both automatically."));
        slider(controls, "Active frame rate", 1, 60, 1, prefs.getInt("fps", FramePolicy.DEFAULT_FPS),
                value -> prefs.edit().putInt("fps", Math.round(value)).apply());
        slider(controls, "Idle frame rate", 1, 60, 1, prefs.getInt("idleFps", FramePolicy.DEFAULT_IDLE_FPS),
                value -> prefs.edit().putInt("idleFps", Math.round(value)).apply());
        slider(controls, "Pointer response", 0, 2, .05f, prefs.getFloat("pointer", 1),
                value -> prefs.edit().putFloat("pointer", value).apply());

        ScrollView scroll = new ScrollView(this);
        scroll.addView(controls);
        LinearLayout root = column();
        root.setBackgroundColor(Color.BLACK);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(android.view.WindowInsets.Type.systemBars()
                        | android.view.WindowInsets.Type.displayCutout());
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        root.addView(preview, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1));
        root.addView(scroll, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1));
        Button set = new Button(this);
        set.setText("Set as wallpaper");
        set.setOnClickListener(v -> startActivity(new Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER)
                .putExtra(WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT, new ComponentName(this, WallpaperService.class))));
        root.addView(set);
        Button studio=new Button(this);studio.setText("Open shared Studio");studio.setOnClickListener(v->startActivity(new Intent(this,StudioActivity.class)));root.addView(studio);
        setContentView(root);
        prefs.registerOnSharedPreferenceChangeListener(this);
    }

    private void rebuildEditor() {
        editor.removeAllViews();
        try {
            JSONObject spec = WallpaperService.chosenSpec(this);
            editor.addView(label("Appearance · saved automatically for this wallpaper and style"));
            selectField("Shape", "shape", Look.names(catalog.getJSONArray("shapes")), spec.optString("shape", "glyph"));
            selectField("Dither", "dither", Look.names(catalog.getJSONArray("dithers")), spec.optString("dither", "none"));
            List<String> charsets = Look.keys(catalog.getJSONObject("charsets"));
            String currentCharset = spec.optString("charset", "classic");
            for (String name : charsets) if (catalog.getJSONObject("charsets").getString(name).equals(currentCharset)) currentCharset = name;
            selectField("Characters", "charset", charsets, currentCharset);
            List<String> palettes = new ArrayList<>(); palettes.add(""); palettes.addAll(Look.keys(catalog.getJSONObject("palettes")));
            List<String> paletteLabels = titles(palettes); paletteLabels.set(0, "Own colours");
            String currentPalette = spec.opt("palette") instanceof String ? spec.getString("palette") : "";
            JSONArray customPalette = spec.optJSONArray("palette");
            if (customPalette != null && customPalette.length() > 0) currentPalette = ":custom";
            for (String name : Look.keys(catalog.getJSONObject("palettes")))
                if (catalog.getJSONObject("palettes").get(name).toString().equals(String.valueOf(spec.opt("palette")))) currentPalette = name;
            if (currentPalette.equals(":custom")) { palettes.add(":custom"); paletteLabels.add("Custom"); }
            editor.addView(label("Palette"));
            editor.addView(choice(paletteLabels, palettes, currentPalette,
                    value -> saveEdit("palette", value.equals(":custom") ? customPalette : value.isEmpty() ? new JSONArray() : value)));
            slider(editor, "Cell size", 3, 32, .5f, (float) spec.optDouble("cell", 8), v -> saveEdit("cell", v));
            slider(editor, "Cell aspect", .3f, 1.5f, .05f, (float) spec.optDouble("aspect", .55), v -> saveEdit("aspect", v));
            slider(editor, "Colour fill", 0, 1, .05f, (float) spec.optDouble("fill", 0), v -> saveEdit("fill", v));
            editor.addView(label("Effects"));
            JSONObject effects = spec.optJSONObject("effects"), ranges = catalog.getJSONObject("effects");
            for (String key : Look.keys(ranges)) {
                JSONArray range = ranges.getJSONArray(key);
                slider(editor, Look.title(key), (float) range.getDouble(0), (float) range.getDouble(1), .05f,
                        effects == null ? 0 : (float) effects.optDouble(key, 0), v -> saveEdit("fx." + key, v));
            }
            Button reset = new Button(this);
            reset.setText("Reset this look");
            reset.setOnClickListener(v -> { prefs.edit().remove(WallpaperService.editsKey(prefs)).apply(); rebuildEditor(); });
            editor.addView(reset);
            Button share = new Button(this);
            share.setText("Share look code");
            share.setOnClickListener(v -> shareRecipe());
            editor.addView(share);
            Button paste = new Button(this);
            paste.setText("Paste look code");
            paste.setOnClickListener(v -> pasteRecipe());
            editor.addView(paste);
        } catch (Exception e) { error(e); }
    }

    private void selectField(String title, String key, List<String> values, String current) {
        editor.addView(label(title));
        editor.addView(choice(titles(values), values, current, value -> saveEdit(key, value)));
    }

    private void saveEdit(String key, Object value) {
        try {
            String storage = WallpaperService.editsKey(prefs);
            JSONObject edits = new JSONObject(prefs.getString(storage, "{}"));
            if (key.startsWith("fx.")) {
                JSONObject effects = WallpaperService.chosenSpec(this).optJSONObject("effects");
                if (effects == null) effects = new JSONObject();
                effects.put(key.substring(3), value);
                edits.put("effects", effects);
            } else edits.put(key, value);
            prefs.edit().putString(storage, edits.toString()).apply();
        } catch (Exception e) { error(e); }
    }

    @Override public void onSharedPreferenceChanged(SharedPreferences p, String key) {
        if (key.equals("fps") || key.equals("idleFps") || key.equals("pointer") || key.equals("quality") || key.equals("paused") || key.equals("clicks")) { configure(); return; }
        try { renderer.setLook(WallpaperService.chosen(this)); pacer.refresh(); }
        catch (Exception e) { error(e); }
        if (key.equals(WallpaperService.WALLPAPER) || key.equals(WallpaperService.STYLE)) rebuildEditor();
    }

    private void configure() { pacer.configure(prefs); renderer.pointerStrength = prefs.getFloat("pointer", 1); }

    private void shareRecipe() {
        try {
            JSONObject spec = WallpaperService.chosenSpec(this), recipe = new JSONObject();
            for (String key : Look.LOOK_KEYS) if (spec.has(key)) recipe.put(key, spec.get(key));
            recipe.put("charset", Look.fromSpec(getAssets(), spec).charset);
            if (recipe.opt("palette") instanceof String)
                recipe.put("palette", catalog.getJSONObject("palettes").getJSONArray(recipe.getString("palette")));
            String shader = spec.getString("shader");
            recipe.put("shader", shader.matches("(?s).*\\bcell\\s*\\(.*") ? shader : Look.read(getAssets(), "specs/" + shader));
            String code = Recipe.encode(recipe.toString());
            startActivity(Intent.createChooser(new Intent(Intent.ACTION_SEND).setType("text/plain")
                    .putExtra(Intent.EXTRA_TEXT, code), "Share look code"));
        } catch (Exception e) { error(e); }
    }

    private void pasteRecipe() {
        EditText input = new EditText(this);
        input.setHint(Recipe.PREFIX + "…");
        input.setMaxLines(5);
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Paste look code")
                .setMessage("Apply an Android, Linux or Windows look to this wallpaper.")
                .setView(input).setNegativeButton("Cancel", null).setPositiveButton("Apply", null).create();
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            try {
                JSONObject edits = Look.recipeEdits(getAssets(), new JSONObject(Recipe.decode(input.getText().toString())));
                Look.fromSpec(getAssets(), Look.spec(getAssets(), prefs.getString(WallpaperService.WALLPAPER, WallpaperService.DEFAULT_WALLPAPER),
                        prefs.getString(WallpaperService.STYLE, WallpaperService.DEFAULT_STYLE), edits));
                prefs.edit().putString(WallpaperService.editsKey(prefs), edits.toString()).apply();
                rebuildEditor(); dialog.dismiss();
            } catch (Exception e) { input.setError(e.getMessage()); }
        }));
        dialog.show();
    }
    private interface Choice { void accept(String value); }
    private interface NumberChoice { void accept(float value); }

    private Spinner choice(List<String> labels, List<String> values, String current, Choice changed) {
        List<String> choices = new ArrayList<>(values), captions = new ArrayList<>(labels);
        if (!choices.contains(current)) { choices.add(current); captions.add("Custom"); }
        Spinner spinner = new Spinner(this);
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, captions);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spinner.setAdapter(adapter);
        int initial = Math.max(0, choices.indexOf(current));
        spinner.setSelection(initial);
        spinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            int last = initial;
            @Override public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                if (position == last) return;
                last = position; changed.accept(choices.get(position));
            }
            @Override public void onNothingSelected(AdapterView<?> parent) { }
        });
        return spinner;
    }

    private void slider(LinearLayout parent, String title, float min, float max, float step, float value, NumberChoice changed) {
        TextView caption = label(title);
        SeekBar slider = new SeekBar(this);
        slider.setContentDescription(title);
        slider.setMax(Math.round((max - min) / step));
        slider.setProgress(Math.round((Math.max(min, Math.min(max, value)) - min) / step));
        caption.setText(title + ": " + number(value) + (value < min || value > max ? " (custom)" : ""));
        slider.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            boolean tracking;
            @Override public void onProgressChanged(SeekBar bar, int progress, boolean fromUser) {
                float v = min + progress * step;
                caption.setText(title + ": " + number(v));
                if (fromUser && !tracking) changed.accept(v);
            }
            @Override public void onStartTrackingTouch(SeekBar bar) { tracking = true; }
            @Override public void onStopTrackingTouch(SeekBar bar) { tracking = false; changed.accept(min + bar.getProgress() * step); }
        });
        parent.addView(caption); parent.addView(slider);
    }

    private static String number(float v) { return String.format(Locale.ROOT, "%.2f", v).replaceAll("\\.?0+$", ""); }
    private static List<String> titles(List<String> values) {
        List<String> result = new ArrayList<>();
        for (String value : values) result.add(value.isEmpty() ? "" : Look.title(value));
        return result;
    }
    private LinearLayout column() { LinearLayout l = new LinearLayout(this); l.setOrientation(LinearLayout.VERTICAL); return l; }
    private int dp(int pixels) { return Math.round(pixels * getResources().getDisplayMetrics().density); }
    private TextView label(String text) {
        TextView view = new TextView(this);
        view.setText(text); view.setTextColor(Color.rgb(160, 170, 166));
        view.setPadding(0, dp(8), 0, dp(4));
        return view;
    }
    private void error(Exception e) { Toast.makeText(this, "asciipaper: " + e.getMessage(), Toast.LENGTH_LONG).show(); }
    @Override protected void onResume() { super.onResume(); if (preview != null) { preview.onResume(); pacer.start(); } }
    @Override protected void onPause() { if (preview != null) { pacer.stop(); preview.onPause(); } super.onPause(); }
    @Override protected void onDestroy() {
        if (prefs != null) prefs.unregisterOnSharedPreferenceChangeListener(this);
        if (pacer != null) pacer.destroy();
        if(preview!=null&&renderer!=null)preview.queueEvent(renderer::dispose);
        super.onDestroy();
    }
}
