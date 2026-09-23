---
name: asciipaper
description: Create, test and install live animated ASCII wallpapers for Linux Wayland desktops (Omarchy, Arch, Hyprland) with asciipaper. Use when the user wants an animated, interactive or ASCII wallpaper, a "live background", or asks to turn an HTML/canvas animation into a desktop wallpaper.
---

# asciipaper

asciipaper renders an `.html` wallpaper and its bundled local assets on the desktop background layer of every monitor. No build step, framework, or server is required.

## Install / run

```sh
git clone https://github.com/cYoren/asciipaper && cd asciipaper && ./install.sh   # Arch: webkitgtk-6.0 python-gobject gtk4-layer-shell
asciipaper list                      # presets: fluid, flow, matrix, yin-yang, asciify
asciipaper set fluid                 # persist + restart service
asciipaper create aurora             # create an editable animated HTML starter
asciipaper /path/to/wallpaper.html   # try a file without saving (Ctrl-C to stop)
```

## Wallpaper contract

Write one `.html` file that:

1. Fills the viewport: `html,body{margin:0;height:100%;overflow:hidden;background:#080909}` and a `<canvas>` (or monospace `<pre>`) sized to `innerWidth × innerHeight`, re-sized on `resize`.
2. Animates with `requestAnimationFrame` (24 fps is a good starting point) rather than an uncapped loop.
3. Draws characters in a monospace font — that's what makes it ASCII. `ctx.fillText` is fine up to a few thousand glyphs; beyond that copy the WebGL glyph-atlas approach in `fluid.html`.
4. Reacts to `pointermove` / `pointerdown` / `wheel` — they fire when the cursor is over the bare desktop. Keyboard never arrives (by design).
5. Uses inline JS or bundled local assets. WebGL is available. No network needed.
6. Loads `./lib/asciipaper.js` to get the portable performance/settings API in browsers and wallpaper hosts; the native engine supplies its current values.

Reference implementations in `wallpapers/`:
- `matrix.html` — 25-line minimum.
- `yin-yang.html` — rotating taijitu, gently follows pointer position and ripples on click.
- `starter.html` — create-your-own template with resize and pointer handling.
- `flow.html` — ~90-line stable-fluids sim (inject → advect → project) with a character ramp and ambient drift.
- `fluid.html` — Asciify's Fluid. Two WebGL fragment-shader passes render the image; JavaScript updates the small fluid field and uploads its pointer texture. It reuses GPU texture storage between frames.

## Test

`asciipaper ./new.html` shows it live. Run it in a browser first for console errors. Prefer shader work for dense per-pixel effects. Lower frame rate or render quality when CPU or power use is high; GPU rendering still needs CPU time for simulation, data upload, and draw submission.

Studio exposes live `fps`, `quality`, and `pointer` settings as `window.asciipaper.options`. Subscribe with `window.asciipaper.onChange(options => { ... })`. The engine caps `requestAnimationFrame` globally, scales `devicePixelRatio` for canvas sizing, and publishes pointer strength so each wallpaper can tune its interaction. Studio shows measured engine plus renderer CPU and suggests lower-cost settings when needed.

## Contribute a preset

Put the file in `wallpapers/`, add `"name": (f"file://{LOCAL}/name.html", None)` to `PRESETS` in `asciipaper`, mention it in README, PR.
