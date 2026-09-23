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

A wallpaper starts as an `.html` file and may include bundled local assets. The contract:

- Fill the viewport: `html,body{margin:0;height:100%;overflow:hidden}` and a `<canvas>` (or a monospace `<pre>`) sized to `innerWidth × innerHeight`; re-size on the `resize` event.
- Animate with `requestAnimationFrame` or `setInterval`; draw characters with `ctx.fillText` in a monospace font (that's what makes it "ASCII").
- It's **pointer-interactive**: `mousemove` / `pointerdown` / `wheel` fire when the cursor is over the bare desktop, so react to them (ripples, wake-up, parallax). Keyboard focus is off by design.
- WebGL is on; no network needed for local files. Any JS the page needs must be inline or bundled — no build step, no server.
- The engine exposes `window.asciipaper.options` (`fps`, `quality`, `pointer`) and `window.asciipaper.onChange(callback)`. The Studio applies these settings live. Its frame-rate cap also limits `requestAnimationFrame`; quality sets canvas pixel density, and pointer response is available to the wallpaper script. See `flow.html`, `fluid.html`, and `yin-yang.html` for examples.
- These settings are optional: artwork should still animate and respond in a regular browser. Use Canvas 2D or WebGL and browser input events; keep Linux APIs out of wallpaper files.

`wallpapers/flow.html` is the reference: a small stable-fluids simulation (inject → advect → pressure-project) drawn as a character ramp, with ambient drift so it moves without a cursor. It runs its simulation and character drawing on the CPU, so it is the heavier example. `yin-yang.html` shows a rotating emblem that leans toward the pointer and ripples on click. `matrix.html` is the minimal example. `fluid.html` is the bundled Asciify Fluid renderer: its fragment shaders draw the image on the GPU, while JavaScript advances the small fluid field and uploads pointer data to a reusable texture. The bundled asciify engine (`lib/asciify-core.js`) is available to local wallpapers via `import … from './lib/asciify-core.js'`.

Run `asciipaper create aurora`, then edit the new HTML under `~/.local/share/asciipaper/user-wallpapers/aurora.html`. It is a plain web page: replace the starter drawing with any canvas, CSS, JavaScript, or WebGL artwork. Listen to `pointermove`, `pointerdown`, `wheel`, and `resize` to make it respond to the desktop. Preview with `asciipaper ~/.local/share/asciipaper/user-wallpapers/aurora.html`; save it as a named option with `asciipaper set aurora`. You can also point asciipaper at any `.html` file you already have.

Prompt that works: *"Write a single-file HTML live ASCII wallpaper for asciipaper: full-screen canvas, monospace fillText, animated with requestAnimationFrame, reacts to mousemove. Theme: ‹ocean waves›."*

## Tuning `fluid`

The image rendering runs in two GPU fragment-shader passes; JavaScript advances the small fluid field and sends it to a reused texture. The default profile is 24 fps at 0.85 render quality. Studio measures the app and WebKit renderer CPU use and offers lower frame rate/quality settings when load is high. The visual can still be GPU-bound on a weaker or software-rendered device, so use the meter and your machine's power use as a guide.

## Add a preset

Edit `PRESETS` in `asciipaper`: `name: (url, selector)`. The selector (optional) is the element to isolate — everything else on the page is removed so the canvas fills the screen.

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
