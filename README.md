# asciipaper

Live, animated, mouse-interactive **ASCII wallpapers** for [Omarchy](https://omarchy.org), Arch Linux and any Wayland compositor with layer-shell (Hyprland, Sway, river, niri…).

Any web page — a preset, a URL, or a local `.html` — rendered GPU-accelerated in WebKitGTK and pinned to the desktop **background layer** of every monitor with [gtk4-layer-shell](https://github.com/wmww/gtk4-layer-shell). Pointer events reach the page when the cursor is over the bare desktop, so wallpapers react to the mouse. Isolated from the shell (can't crash it), idles when covered by windows, runs as a systemd user service.

Ships with an offline, 1:1 port of the [asciify.org Fluid background](https://asciify.org/docs/backgrounds/fluid).

![asciipaper running the Fluid wallpaper on the Omarchy desktop](assets/demo.gif)

_[Full-quality demo (MP4)](assets/demo.mp4)_

## Install

```sh
git clone https://github.com/cYoren/asciipaper && cd asciipaper && ./install.sh
```

Deps: WebKitGTK 6.0, gtk4-layer-shell, PyGObject. `install.sh` knows pacman (tested), dnf and apt (untested — PRs welcome). Remove with `./install.sh uninstall`.

Works on any Wayland compositor that implements `wlr-layer-shell`: Hyprland, Sway, niri, river, Wayfire, labwc, KDE Plasma. Not GNOME (Mutter has no layer-shell) and not X11.

## Use

```sh
asciipaper list                 # presets
asciipaper set fluid            # Asciify's Fluid background, offline port (default)
asciipaper set flow             # stable-fluids sim, character ramp (offline)
asciipaper set matrix           # matrix rain (offline)
asciipaper set yin-yang         # rotating, cursor-responsive ASCII emblem
asciipaper set asciify          # offline Asciify Fluid renderer
asciipaper set https://…        # any page
asciipaper set ~/my/rain.html   # any local file
asciipaper create aurora        # copy a ready-to-edit wallpaper starter
```

The Studio lets you choose or import wallpapers, create an editable copy, and tune frame rate, render quality, and pointer response while the wallpaper is running. It reports CPU use for the engine and WebKit renderer processes and can apply lower-cost settings. All launches talk to one application instance, so changing presets replaces the current wallpaper instead of starting a second engine. `set` saves to `~/.config/asciipaper/wallpaper` and restarts the service on a native install. Run `asciipaper <target>` to switch the live wallpaper from the command line.

## Write your own (or ask an AI to)

A wallpaper is an `.html` file plus any local assets. Any web page works, but `lib/asciipaper.js` gives you an ASCII engine: you write what each character cell looks like and it handles the grid, glyphs, GPU drawing, frame pacing and input.

```html
<script src="./lib/asciipaper.js"></script>
<script>
asciipaper.ascii({
  charset: ' .:-=+*#%@', cell: 10, aspect: .6,        // glyphs, cell width in px, width/height
  glsl: `vec4 cell(vec2 uv) {                          // runs on the GPU for every cell
    float d = length((uv - u_pointer) * vec2(u_aspect, 1.0));
    float level = 0.5 + 0.5 * sin(d * 30.0 - u_time * 3.0);
    return vec4(0.2, 0.8, 0.7, level);                 // rgb, and level 0..1 picks the glyph
  }`,
});
</script>
```

- **GPU mode** (`glsl`): `cell(uv)` gets the cell centre (0..1, top left). Built in: `u_time`, `u_grid` (cols, rows), `u_size` (px), `u_aspect`, `u_pointer`, `u_velocity`, `u_down`, `u_idle` (seconds since the pointer moved), `u_strength` (pointer setting), `u_clicks[8]` (x, y, age). Declare your own `uniform`s and set them in `update(scene, dt)` via `scene.uniforms.name = value`, or pass textures with `scene.texture(name, w, h, rgbaBytes)`.
- **CPU mode** (no `glsl`): write cells in `update(scene, dt)` with `scene.put(col, row, level, r, g, b)`; the engine uploads and draws them. Good for simulations and games (`flow.html`).
- Other options: `font`, `background`, `maxCells`, `lut` (256 glyph indices for an exact brightness ramp), `time`/`period` (time wraps every `period` seconds so floats stay precise), `resize(scene)`, `canvas`.
- Input: `asciipaper.pointer` (`x`, `y`, `vx`, `vy`, `down`, `inside`, `clicks`), or plain DOM events (`pointermove`, `pointerdown`, `wheel`) which fire when the cursor is over the bare desktop. Keyboard never arrives, by design.
- Settings: `asciipaper.options` (`fps`, `idleFps`, `quality`, `pointer`, `paused`) and `asciipaper.onChange(callback)`. You don't need to throttle anything: the engine paces every `requestAnimationFrame` on the page, at `fps` while the pointer is active, `idleFps` otherwise, and stops entirely while a fullscreen window covers that monitor (Hyprland).
- Plain Canvas/WebGL/CSS pages still work and get the same pacing. Keep Linux APIs out of wallpaper files; they also run in a regular browser and in Lively on Windows.

```sh
asciipaper create aurora        # copy the starter to ~/.local/share/asciipaper/user-wallpapers/aurora.html
asciipaper preview aurora       # normal window, reloads on every save, console output in the terminal
asciipaper set aurora           # make it the wallpaper (it hot-reloads on save too)
```

Examples in `wallpapers/`: `starter.html` (the template), `matrix.html` (stateless rain, pure shader), `yin-yang.html` (JS drives uniforms, shader draws), `flow.html` (CPU fluid sim), `fluid.html` (asciify's Fluid: shader plus a small CPU pointer field passed as a texture).

Prompt that works: *"Write an asciipaper wallpaper: one HTML file that loads ./lib/asciipaper.js and calls asciipaper.ascii({glsl}) (see README). Theme: ‹ocean waves›, reacts to the pointer and clicks."*

## Performance

Every preset draws through the GPU renderer, so the CPU only sets a few uniforms per frame. The defaults are 24 fps with the pointer on the desktop, 12 fps otherwise, render quality 1.0 (device pixels; above 1 supersamples), and no rendering behind fullscreen windows. Studio has sliders for each and shows measured CPU use.

The built-in presets run on `asciipaper-engine` (`native/`, built by `install.sh`), a small C program that runs the same shaders through EGL and OpenGL ES without WebKit. It supports pointer and click effects, HiDPI and fractional scaling, and monitor hotplug, on any compositor with layer-shell. In one test it used under 1% CPU and about 110 MB for the matrix preset, where WebKit used 8% and around 1 GB. Your own HTML wallpapers and URLs still use WebKit. To run the built-in presets in WebKit too, add `"renderer": "web"` to `~/.config/asciipaper/engine.json`. The engine's shaders are copies of those in `wallpapers/*.html` (see `native/presets.c`), so edit both when you change a preset.

WebKit applies the desktop's text-scaling factor as page zoom, so with text scaling above 1 the web versions draw larger characters than the native engine.

## Add a preset

Put the file in `wallpapers/` and add `"name": f"file://{LOCAL}/name.html"` to `PRESETS` in `asciipaper`.

## Flathub

The repository includes an AppStream entry, desktop launcher, icon, and Flatpak build manifest. The Flatpak Studio can create, import, and edit HTML wallpapers, and user files stay in Flatpak's private data area. The wallpaper engine needs the compositor's `wlr-layer-shell` Wayland protocol to place a surface behind the desktop.

There is a Flatpak integration blocker before this can be submitted as a working wallpaper app: Flatpak's normal Wayland socket filters out the layer-shell protocol. Its `inherit-wayland-socket` permission can bypass that filtering, but it is explicitly a sensitive permission that exposes the parent Wayland client's state, and it only works when the launcher passes an inherited `WAYLAND_SOCKET` file descriptor. The standard desktop launcher does not provide that descriptor on the tested system. In that launch path, the Studio can edit wallpapers but cannot apply them. GNOME and X11 also do not provide the layer-shell protocol. The native install works on compatible compositors such as Hyprland, Sway, niri, river, Wayfire, and labwc.

The manifest targets the current Flathub GNOME 51 runtime. It still needs a pinned source revision and a passing Flathub linter run against the final committed source before submission. Flathub requires graphical apps to ship valid AppStream metadata and screenshots, and reviews submissions through its GitHub submission repository; see [Flathub's submission guide](https://docs.flathub.org/docs/for-app-authors/submission).

For local packaging experiments, install `flatpak-builder`, the GNOME 51 SDK, and runtime, then run:

```sh
flatpak-builder --user --install --force-clean build-dir io.github.cyoren.asciipaper.yml
flatpak run io.github.cyoren.asciipaper
```

The manifest source currently tracks `main` for local development. A publishable build needs an immutable upstream source revision, screenshots, a clean lint/build on both supported architectures, and a solution accepted by Flathub for the Wayland protocol restriction.

## Notes

- One full-screen surface per monitor; monitors plugged in later get one too.
- Uses the compositor's `background` layer, so it sits under Omarchy's shell, bars and windows. When fully covered, WebKit stops rendering, so it costs ~0 CPU while you work.
- Omarchy theme changes don't touch it; `asciipaper set …` is the only knob.
- For AI agents: see [`skills/asciipaper/SKILL.md`](skills/asciipaper/SKILL.md) — install with `npx skills add cYoren/asciipaper`.

## Credits

- `wallpapers/fluid.html` is the [asciify.org Fluid background](https://asciify.org/docs/backgrounds/fluid) running offline: `FluidField` + `paintLiquidSource` ported from [asciify-engine](https://github.com/ayangabryl/asciify-engine) `src/surface/fluid-field.ts`, glyphs rendered by the unmodified engine (`wallpapers/lib/asciify-core.js`, v4.1.0). By [ayangabryl](https://github.com/ayangabryl), MIT — `licenses/asciify-engine-MIT.txt`.
- Background layer via [gtk4-layer-shell](https://github.com/wmww/gtk4-layer-shell).

## License

MIT
