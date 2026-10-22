# asciipaper engine

A small GPU renderer that turns one GLSL function into animated ASCII art, and gives it
back to you as a live wallpaper, a page background, a looping video, a GIF or a still.

It is built to be driven by an agent (or by hand): write `vec4 cell(vec2 uv)`, render a
frame to look at it, change something, render again, export when it is right.

```glsl
vec4 cell(vec2 uv) {
  float glow = smoothstep(0.5, 0.0, length(uv - vec2(0.5)));
  return vec4(vec3(0.55, 0.9, 0.84) * glow, glow);   // rgb = ink, a = brightness
}
```

The engine runs that once per character cell, maps brightness to a glyph from a ramp and
draws every cell with its own colour. Per frame the CPU only sets uniforms, so a whole
screen of characters costs about as much as one full-screen quad.

**[ASCII Paper](https://cyoren.github.io/asciipaper/)** is the app built on this engine
(Studio, Discover packs, community, Windows / Linux / macOS / Android apps).

## What you can make with it

| Result | How |
|---|---|
| live wallpaper on a Wayland desktop | `./native/asciipaper-engine plasma` |
| still image, any resolution | `./native/asciipaper-engine --spec wallpapers/specs/tunnel.json --lib wallpapers/lib --snapshot tunnel.png --size 3840x2160 --seconds 4` |
| video or GIF | `--record 30 --warmup 2 \| ffmpeg -f rawvideo -pix_fmt bgra -s 1920x1080 -r 30 -i - out.mp4` |
| background inside a web page | a `<canvas>` plus `asciipaper.ascii({canvas, glsl})` (see `wallpapers/embed.html`) |
| a shareable wallpaper file | the same JSON spec, on any platform |

## For agents

The loop is four commands. Nothing needs a server, an account or a network.

```sh
# 1. a wallpaper is one JSON file and one shader (start from an example)
cp wallpapers/specs/plasma.json  my-wallpaper.json
cp wallpapers/specs/plasma.glsl  my-wallpaper.glsl

# 2. render a frame and look at it (--seconds picks the moment, so it is repeatable)
./native/asciipaper-engine --spec my-wallpaper.json --lib wallpapers/lib \
    --snapshot try-1.png --size 1280x720 --seconds 4

# 3. change the shader or the look, render try-2.png, compare, repeat

# 4. export: a still, a clip, or ship the JSON to a page
./native/asciipaper-engine --spec my-wallpaper.json --lib wallpapers/lib \
    --snapshot poster.png --size 3840x2160 --seconds 6
```

Rules that keep renders honest:

- **Deterministic frames.** `--seconds N` simulates exactly N seconds of the scene, so the
  same spec always gives the same frame. `--pointer X,Y` simulates the pointer.
- **No hidden state.** The spec declares everything: glyphs, cell size, colours, dither,
  palette, effects, interaction. `wallpapers/lib/looks.json` lists every name you may use.
- **Two renderers, one language.** The C engine and the WebGL runtime run the same shaders
  and specs, so a wallpaper previewed in a browser is pixel-compatible on a desktop.

A prompt that works:

> Write an asciipaper wallpaper: a JSON spec plus a GLSL `vec4 cell(vec2 uv)` returning
> colour and a 0..1 brightness, using `u_time`, `u_aspect`, `u_pointer` and `u_clicks`.
> Run `./native/asciipaper-engine --spec wallpaper.json --lib wallpapers/lib
> --snapshot frame.png --seconds 4`, look at the frame, and iterate until it reads well at
> 1280×720 with `cell: 8`. Export a still when it is done.

Read next: the spec and uniform reference below, `llms.txt`, and the three examples in
`wallpapers/specs/`.

## Two renderers, one language

| | What it is | Where it runs |
|---|---|---|
| `native/` | C, OpenGL ES, Wayland layer-shell | Linux desktops: behind your icons, on every monitor; PNG and video export |
| `wallpapers/lib/asciipaper.js` | the same renderer in WebGL 1 | any browser, and the Windows / macOS / Android hosts |

`native/shaders.h` and `wallpapers/lib/shaders/` are generated from the web runtime by
`tools/generate_runtime.py`, so the two sides cannot drift apart.

## Build

```sh
make                  # the native engine, into native/asciipaper-engine
make test             # spec + shader checks (needs python3 and glslangValidator)
```

Build deps: a C compiler, `pkg-config`, `libwayland-client`, `libwayland-egl`, `libegl`,
`libgles2`, `pangocairo`, `wayland-scanner` and `wayland-protocols`.

## Run it

```sh
./native/asciipaper-engine plasma                        # live, on every Wayland output
python3 -m http.server -d wallpapers 8000                # then /run.html?spec=specs/plasma.json
```

Useful flags: `--spec FILE`, `--lib DIR` (where `media.glsl` lives), `--snapshot OUT.png`,
`--size WxH`, `--seconds S`, `--pointer X,Y`, `--record FPS`, `--warmup S`, `--headless`.

## A wallpaper is a JSON file plus a shader

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

Everything a look can have is a key in the same file: `shape` (pixels, dots, LEGO, CMYK,
truchet, hex…), `dither` (ordered patterns), `palette` (nearest-colour inks), `effects`
(`{"crt": 1}`, scanlines, bloom, glitch, grain, posterize, vhs…), `interaction` (`glow`,
`magnify`, `repel`, `attract`, `swirl`, `ripple`), `speed`, `pace`, `weight`, `maxCells`,
`font`, `color`. The names and ranges are all in `wallpapers/lib/looks.json`.

A shader may declare its own defaults on the first line, overridable per spec:

```glsl
// defaults: {"speed": 1, "tint": "#8de5d7"}
uniform float speed;
uniform vec3 tint;
```

`cell(uv)` gets:

| uniform | meaning |
|---|---|
| `u_time` | seconds, scaled by the speed setting |
| `u_aspect` | width / height |
| `u_grid` | cells across, cells down |
| `u_size` | output size in pixels |
| `u_pointer`, `u_velocity`, `u_down`, `u_strength`, `u_idle` | pointer, 0..1 |
| `u_clicks[8]` | recent clicks as `(x, y, age)` |
| `u_data` | RGBA image, for CPU-driven or imported-media scenes |

Return `vec4(rgb, level)`: `level` (0..1) picks the glyph, `rgb` is that cell's ink. Shaders
are GLSL ES 1.0, so they run unchanged on the native and the web side.

## In a web page

Give the runtime a canvas and it sizes the cells to that box (`wallpapers/embed.html` is a
working page):

```html
<canvas id="art" style="width:100%;height:420px;display:block"></canvas>
<script src="asciipaper.js"></script>
<script>
  asciipaper.ascii({
    canvas: document.getElementById('art'),
    charset: ' .:-=+*#%@', cell: 8, aspect: .55, background: '#050708',
    glsl: `vec4 cell(vec2 uv){
      float l = .5 + .5 * sin(u_time + length(uv - .5) * 12.0);
      return vec4(vec3(.6,.9,.85) * l, l);
    }`
  });
</script>
```

Or run a whole spec file: `asciipaper.load('wallpapers/plasma.json')`.

The runtime API: `ascii(config)`, `load(url)`, `patch(url)` (apply uniform-only edits to a
running scene), `set(options)` (fps, idleFps, quality, speed, pointer, paused), `capture()`,
`beat` (timestamp of the last drawn frame).

## Credits

MIT, see `LICENSE`. The `fluid` scene is a 1:1 port of [asciify](https://asciify.org)
(MIT, `licenses/asciify-engine-MIT.txt`). The look tables were inspired by ASCII Magic;
every shader and line of code here is written for this engine.
