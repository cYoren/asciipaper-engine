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

Write one `.html` file that loads `./lib/asciipaper.js` and calls `asciipaper.ascii({...})`. See README "Write your own" for the full API. In short:

1. `glsl`: define `vec4 cell(vec2 uv)` returning `(r, g, b, level)`; `level` 0..1 picks a glyph from `charset`. Uniforms: `u_time u_grid u_size u_aspect u_pointer u_velocity u_down u_idle u_strength u_clicks[8]`, plus your own set via `scene.uniforms` in `update(scene, dt)`.
2. Or no `glsl`: write cells on the CPU in `update` with `scene.put(col, row, level, r, g, b)`.
3. Never throttle yourself: the engine paces `requestAnimationFrame` (fps / idleFps / paused behind fullscreen).
4. Input is pointer only (`asciipaper.pointer` or DOM pointer events). No keyboard, no network.

Reference implementations in `wallpapers/`: `starter.html` (template), `matrix.html` (pure shader), `yin-yang.html` (JS uniforms + shader), `flow.html` (CPU sim), `fluid.html` (shader + CPU field texture + asciify LUT).

## Test

`asciipaper preview ./new.html` opens a normal window that reloads on save and prints console errors (including shader compile errors) to the terminal.

## Contribute a preset

Put the file in `wallpapers/`, add `"name": f"file://{LOCAL}/name.html"` to `PRESETS` in `asciipaper`, mention it in README, PR.
