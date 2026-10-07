package io.github.cyoren.asciipaper;

import android.app.Activity;
import android.app.WallpaperManager;
import android.content.ComponentName;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.opengl.GLSurfaceView;
import android.os.Bundle;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import org.json.JSONObject;

// Choose a wallpaper and a style, watch it live, and set it. The wallpaper follows these choices.
public class MainActivity extends Activity {
    private GLSurfaceView preview;
    private Renderer renderer;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        SharedPreferences prefs = getSharedPreferences(WallpaperService.PREFS, MODE_PRIVATE);
        List<String> wallpapers = new ArrayList<>(), styles = new ArrayList<>(), labels = new ArrayList<>();
        try {
            wallpapers = Look.wallpapers(getAssets());
            JSONObject all = Look.looks(getAssets()).getJSONObject("styles");
            for (Iterator<String> keys = all.keys(); keys.hasNext(); ) {
                String name = keys.next();
                styles.add(name);
                labels.add(Look.title(name) + ": " + all.getJSONObject(name).optString("about"));
            }
            renderer = new Renderer(Look.shaders(getAssets()), getResources().getDisplayMetrics().density, WallpaperService.chosen(this));
        } catch (Exception e) {
            Toast.makeText(this, "asciipaper can't load its wallpapers: " + e.getMessage(), Toast.LENGTH_LONG).show();
            finish();
            return;
        }

        preview = new GLSurfaceView(this);
        preview.setEGLContextClientVersion(2);
        preview.setRenderer(renderer);
        preview.setOnTouchListener((v, e) -> {
            int action = e.getActionMasked();
            renderer.touch(e.getX() / v.getWidth(), e.getY() / v.getHeight(),
                    action == MotionEvent.ACTION_DOWN || action == MotionEvent.ACTION_MOVE);
            return true;
        });

        LinearLayout controls = new LinearLayout(this);
        controls.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (16 * getResources().getDisplayMetrics().density);
        controls.setPadding(pad, pad / 2, pad, pad);
        controls.setBackgroundColor(Color.rgb(12, 14, 14));
        List<String> wallpaperLabels = new ArrayList<>();
        for (String w : wallpapers) wallpaperLabels.add(Look.title(w));
        controls.addView(label("Wallpaper"));
        controls.addView(spinner(wallpaperLabels, wallpapers, prefs, WallpaperService.WALLPAPER, WallpaperService.DEFAULT_WALLPAPER));
        controls.addView(label("Style"));
        controls.addView(spinner(labels, styles, prefs, WallpaperService.STYLE, WallpaperService.DEFAULT_STYLE));
        Button set = new Button(this);
        set.setText("Set as wallpaper");
        set.setOnClickListener(v -> startActivity(new Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER)
                .putExtra(WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT, new ComponentName(this, WallpaperService.class))));
        controls.addView(set);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.BLACK);
        root.addView(preview, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1));
        root.addView(controls);
        setContentView(root);
    }

    private TextView label(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(Color.rgb(160, 170, 166));
        view.setPadding(0, view.getPaddingTop() + 12, 0, 0);
        return view;
    }

    // A choice saved to the preferences the wallpaper reads; the preview follows it too.
    private Spinner spinner(List<String> labels, List<String> values, SharedPreferences prefs, String key, String fallback) {
        Spinner spinner = new Spinner(this);
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, labels);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spinner.setAdapter(adapter);
        spinner.setGravity(Gravity.START);
        spinner.setSelection(Math.max(0, values.indexOf(prefs.getString(key, fallback))));
        spinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                if (values.get(position).equals(prefs.getString(key, fallback))) return;
                prefs.edit().putString(key, values.get(position)).apply();
                try { renderer.setLook(WallpaperService.chosen(MainActivity.this)); } catch (Exception e) {
                    Toast.makeText(MainActivity.this, e.getMessage(), Toast.LENGTH_LONG).show();
                }
            }
            @Override public void onNothingSelected(AdapterView<?> parent) { }
        });
        return spinner;
    }

    @Override protected void onResume() { super.onResume(); if (preview != null) preview.onResume(); }
    @Override protected void onPause() { if (preview != null) preview.onPause(); super.onPause(); }
}
