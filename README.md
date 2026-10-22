# asciipaper engine

A small GPU renderer that turns a **single GLSL function** into a wall of characters.

You write one function per wallpaper:

```glsl
vec4 cell(vec2 uv) {
  float glow = smoothstep(0.5, 0.0, length(uv - vec2(0.5)));
  return vec4(vec3(0.55, 0.9, 0.84) * glow, glow);   // rgb = colour, a = brightness
}
```

The engine runs it once per character cell, turns the brightness into a glyph from a
character ramp, and draws every cell with its own colour. Per frame the CPU only updates
uniforms, so a whole screen of characters costs about as much as one full-screen quad.

This repository is the engine alone. **[ASCII Paper](https://cyoren.github.io/asciipaper/)**
is the app built on it (Studio, Discover packs, community, Windows, Linux, macOS and
Android apps).

## Two renderers, one language

| | What it is | Where it runs |
|---|---|---|
| `native/` | C, OpenGL ES, Wayland layer-shell | Linux desktops: draws behind your icons, on every monitor |
| `wallpapers/lib/asciipaper.js` | the same renderer in WebGL 1 | any browser, and the Windows / macOS / Android hosts |

Both run **the same shaders, the same JSON specs and the same look tables**
(`wallpapers/lib/looks.json`, `native/shaders.h` is generated from it), so a wallpaper
authored for one is pixel-identical on the other.

## Build

```sh
make                  # the native engine, into native/asciipaper-engine
make test             # spec + runtime checks (needs python3, a JDK and glslangValidator)
```

Only needed at build time: a C compiler, `pkg-config`, `libwayland-client`, `libegl`,
`libgles2`, `cairo` (PNG export), and `python3` (generates `native/shaders.h` and
`wallpapers/lib/legacy.js` so the two renderers never drift apart).

## Run it

```sh
# a live wallpaper on every Wayland output (layer-shell; Hyprland, KDE, Sway, niri, river…)
./native/asciipaper-engine plasma

# one frame, instead of a wallpaper
./native/asciipaper-engine --spec wallpapers/specs/tunnel.json --lib wallpapers/lib \
    --snapshot tunnel.png --size 1920x1080 --seconds 6

# a video or GIF (needs ffmpeg)
./native/asciipaper-engine --spec wallpapers/specs/starfield.json --lib wallpapers/lib \
    --record 30 --warmup 2 | ffmpeg -f rawvideo -pix_fmt bgra -s 1920x1080 -r 30 -i - out.mp4
```

In a browser, serve the folder and open a spec:

```sh
python3 -m http.server -d wallpapers 8000
# http://localhost:8000/run.html?spec=specs/plasma.json
```

Useful flags: `--pointer X,Y` (simulate the pointer), `--lib DIR` (where `media.glsl`
lives), `--headless` (no Wayland), `--help`.

## A wallpaper is a JSON file plus a shader

`wallpapers/specs/plasma.json`:

```json
{
  "title": "Plasma",
  "shader": "plasma.glsl",
  "charset": " .:-=+*#%@",
  "cell": 9,
  "aspect": 0.55,
  "fill": 0.2,
  "background": "#050507"
}
```

Anything a look can have goes in the same file: `shape` (pixels, dots, LEGO, CMYK…),
`dither` (ordered patterns), `palette` (nearest-colour inks), `effects` (`{"crt": 1}`,
scanlines, bloom, glitch, grain, posterize…), `interaction` (`glow`, `magnify`, `repel`,
`attract`, `swirl`, `ripple`), `speed`/`pace`, `weight`, `maxCells`, `color`.

The shader may hold its own defaults on the first line, overridable per spec:

```glsl
// defaults: {"speed": 1, "tint": "#8de5d7"}
uniform float speed;
uniform vec3 tint;
```

`cell(uv)` gets:

| uniform | meaning |
|---|---|
| `u_time` | seconds, slowed by the speed setting |
| `u_aspect` | width / height |
| `u_grid` | cells across, cells down |
| `u_size` | output size in pixels |
| `u_pointer`, `u_velocity`, `u_down`, `u_strength`, `u_idle` | pointer, 0..1 |
| `u_clicks[8]` | recent clicks as `(x, y, age)` |
| `u_data` | RGBA image, for CPU-driven or imported media scenes |

Return `vec4(rgb, level)`: `level` (0..1) picks the glyph, `rgb` is that cell's ink.
Shaders are GLSL ES 1.0 so they run on the native and the web side without changes.

## The web runtime

`asciipaper.js` exposes `window.asciipaper`:

- `ascii(config)` — render a scene: `{glsl, charset, cell, aspect, palette, dither, shape, effects, interaction, background, fill, fps, idleFps}`. Returns a scene with `time`, `uniforms`, `texture(name, w, h, bytes)`, `put(col, row, level, r, g, b)`.
- `load(url)` — run a spec straight from its JSON; `patch(url)` re-applies uniform-only edits live.
- `set(options)` — host settings (fps, idle fps, quality, speed, pointer, paused).
- `capture()` — the current frame as a PNG blob; `beat` — `performance.now()` of the last frame.

Frame pacing, pointer input, the glyph atlas and the two-pass cell/glyph pipeline are all
inside; a host only injects the file and talks settings.

## Credits

MIT, see `LICENSE`. The `fluid` scene is a 1:1 port of [asciify](https://asciify.org)
(MIT, `licenses/asciify-engine-MIT.txt`). The look tables were inspired by ASCII Magic;
every shader and line of code here is written for this engine.
