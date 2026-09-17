---
name: asciipaper
description: Create, test and install live animated ASCII wallpapers for Linux Wayland desktops (Omarchy, Arch, Hyprland) with asciipaper. Use when the user wants an animated, interactive or ASCII wallpaper, a "live background", or asks to turn an HTML/canvas animation into a desktop wallpaper.
---

# asciipaper

asciipaper renders a single self-contained `.html` file on the desktop background layer of every monitor. A wallpaper is just that file. No build step, no framework, no server.

## Install / run

```sh
git clone https://github.com/cYoren/asciipaper && cd asciipaper && ./install.sh   # Arch: webkitgtk-6.0 python-gobject gtk4-layer-shell
asciipaper list                      # presets: fluid, flow, matrix, asciify
asciipaper set fluid                 # persist + restart service
asciipaper /path/to/wallpaper.html   # try a file without saving (Ctrl-C to stop)
```

## Wallpaper contract

Write one `.html` file that:

1. Fills the viewport: `html,body{margin:0;height:100%;overflow:hidden;background:#080909}` and a `<canvas>` (or monospace `<pre>`) sized to `innerWidth × innerHeight`, re-sized on `resize`.
2. Animates with `requestAnimationFrame` (cap at ~30 fps to save CPU) or `setInterval`.
3. Draws characters in a monospace font — that's what makes it ASCII. `ctx.fillText` is fine up to a few thousand glyphs; beyond that copy the WebGL glyph-atlas approach in `fluid.html`.
4. Reacts to `pointermove` / `pointerdown` / `wheel` — they fire when the cursor is over the bare desktop. Keyboard never arrives (by design).
5. Uses only inline JS or `import … from './lib/asciify-core.js'` (the MIT asciify-engine core, available to every wallpaper in `wallpapers/`). WebGL is available. No network needed.

Reference implementations in `wallpapers/`:
- `matrix.html` — 25-line minimum.
- `flow.html` — ~90-line stable-fluids sim (inject → advect → project) with a character ramp and ambient drift.
- `fluid.html` — asciify.org's Fluid, fully on the GPU: pass 1 evaluates the liquid field + tint per cell and looks up the glyph in a 256-entry LUT the engine produced at startup; pass 2 draws a glyph atlas. JS per frame: step the small pointer field, two draw calls. ~5 % CPU at 1080p/24 fps — copy this structure for anything dense.

## Test

`asciipaper ./new.html` shows it live. Run it in any browser first for console errors. Check CPU with `ps -eo %cpu,cmd | grep WebKitWebProcess`; WebKit's own floor is ~0.2 % per fps, so budget ≤ 5 % at 24 fps. Above that: move per-pixel work into a fragment shader (see `fluid.html`), raise the cell size, or lower the fps.

## Contribute a preset

Put the file in `wallpapers/`, add `"name": (f"file://{LOCAL}/name.html", None)` to `PRESETS` in `asciipaper`, mention it in README, PR.
