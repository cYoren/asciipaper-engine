---
name: asciipaper
description: Create, port, test and install live interactive ASCII wallpapers with asciipaper (Linux Wayland: Omarchy, Arch, Hyprland, KDE, Sway, niri; exports for Windows and macOS). Use when the user wants an animated, interactive or ASCII wallpaper or "live background", wants to turn a picture, GIF, video or X/Twitter post into an ASCII wallpaper, or asks to make a shader or HTML animation into a desktop wallpaper.
---

# asciipaper

asciipaper draws ASCII wallpapers on the desktop background layer of every monitor. Built-in scenes and "spec" wallpapers (JSON + GLSL) run on a small native engine (`asciipaper-engine`); HTML wallpapers run in WebKit.

## Install / run

```sh
yay -S asciipaper && systemctl --user enable --now asciipaper.service   # Arch (AUR)
git clone https://github.com/cYoren/asciipaper && cd asciipaper && ./install.sh   # elsewhere
asciipaper list                       # library: fluid, flow, matrix, yin-yang, plus the user's
asciipaper set fluid                  # choose and keep
asciipaper --studio                   # GUI: gallery, live Look settings, porting, export
```

If the `asciipaper` MCP tools are connected (`asciipaper mcp`), prefer them: `write_wallpaper` returns a snapshot of the result (or the shader error), so iterate until it looks right, then `set_wallpaper`.

## Restyle any shader or ported wallpaper

```sh
asciipaper styles                                  # the full catalogue
asciipaper look NAME STYLE [key=value …]           # e.g. look rain lego effects.crt=0.5 warp=twirl palette=gameboy
asciipaper recipe NAME                             # the look as one asciipaper:v1: line; look/import take it back
asciipaper render NAME shot.png --size 3840x2160   # a still that carries its recipe
asciipaper text "HELLO" [name]                     # big text as a wallpaper
```

Spec keys for a look (engine and web): `shape` (glyph pixel mosaic dots led lego cross diamond lines diagonal voxel disco cmyk), `dither` (none bayer2 bayer4 bayer8 bayer16 halftone radial linesH linesV linesD whiteNoise blueNoise), `palette` (up to 16 `"#rrggbb"`; `asciipaper look` also takes names), `effects` (`{"vignette", "scanlines", "crt", "rgbSplit", "grain", "glitch", "bloom", "dust", "flicker": 0..1, "saturation": -1..1, "hue": -0.5..0.5}`). Ported media also takes `uniforms.warp` (0 none, 1 twirl, 2 spherize, 3 ripple, 4 zigzag, 5 polar, 6 kaleidoscope, 7 shear) and `uniforms.warpAmount`. Shape looks want `"aspect": 1`.

## Port a picture, GIF or video

```sh
asciipaper import ./clip.mp4 [name]              # also .gif/.png/.jpg/.webp…, a URL, or an X/Twitter post URL
```

Needs ffmpeg. Writes `~/.local/share/asciipaper/user-wallpapers/<name>.json` (a spec with `"media"`) and applies it. Tune its look by editing the JSON's `charset`, `cell`, `weight`, `fill`, `background` and `uniforms` (media shader: `fit zoom offset contrast brightness gamma threshold invert colorMode vivid tint tint2 backdrop lens ripple speed`; colours as `"#rrggbb"`). The engine reloads on save.

## Write a shader wallpaper (preferred: native and web)

```sh
asciipaper create aurora     # aurora.json + aurora.glsl in the library
asciipaper set aurora        # show it; saving either file updates the desktop
```

`aurora.glsl` defines `vec4 cell(vec2 uv)`: `uv` is the character centre (0..1, top left); return `(r, g, b, level)`, `level` 0..1 picks a character from `charset`. Built-in uniforms: `u_time u_grid u_size u_aspect u_pointer u_velocity u_down u_idle u_strength u_clicks[8]` (x, y, age). Declare your own `uniform float x;` and set it in the spec's `"uniforms"`; a first line `// defaults: {"x": 1}` gives defaults. GLSL ES 1.00 (WebGL 1). Shader errors print to stderr / `journalctl --user -u asciipaper`, and the last good shader keeps running.

Check it without a desktop: `asciipaper-engine --spec aurora.json --lib <data>/wallpapers/lib --snapshot out.png --seconds 3 [--pointer 0.5,0.5]`.

## HTML wallpapers (WebKit)

One `.html` that loads `./lib/asciipaper.js` and calls `asciipaper.ascii({charset, cell, aspect, glsl, update(scene, dt)})`, or any page at all. `asciipaper create NAME --html` makes a starter; `asciipaper preview FILE` reloads on save and prints console errors. Pointer only (`asciipaper.pointer` or DOM pointer events), no keyboard, no network; don't throttle `requestAnimationFrame` (the engine paces it). References in `wallpapers/`: `matrix.html` (pure shader), `yin-yang.html` (JS uniforms), `flow.html` (CPU `scene.put`), `fluid.html` (shader + texture + LUT).

## Share

- `asciipaper export NAME [out.zip]`: Wallpaper Engine (`project.json`), Lively (the ZIP) and Plash on macOS (`index.html`).
- `asciipaper render NAME out.mp4|webm|gif [--seconds S] [--size WxH]`: a video or GIF, for GNOME/X11/phones or posting.

## Contribute a built-in preset

Add `wallpapers/<name>.html` and `PRESETS` in `asciipaper`; for the native engine, port its GLSL and JS to `native/presets.c` and add it to `NATIVE`.
