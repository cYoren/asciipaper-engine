# asciipaper

Live ASCII wallpapers for [Omarchy](https://omarchy.org) and Arch Linux (Hyprland / any wlroots-style Wayland compositor with layer-shell).

Any web page — a preset, a URL, or a local `.html` — rendered GPU-accelerated in WebKitGTK and pinned to the desktop **background layer** with [gtk4-layer-shell](https://github.com/wmww/gtk4-layer-shell). Pointer-interactive, isolated from the shell (can't crash it), runs as a systemd user service.

## Install

```sh
git clone https://github.com/cYoren/asciipaper && cd asciipaper && ./install.sh
```

Deps (Arch): `webkit2gtk-4.1 python-gobject gtk4-layer-shell`.

## Use

```sh
asciipaper list                 # presets
asciipaper set fluid            # interactive ASCII fluid sim (default, offline)
asciipaper set matrix           # matrix rain (offline)
asciipaper set asciify          # asciify.org's fluid page (needs internet)
asciipaper set https://…        # any page
asciipaper set ~/my/rain.html   # any local file
```

`set` saves to `~/.config/asciipaper/wallpaper` and restarts the service. Run `asciipaper <target>` directly to try one without saving.

## Write your own (or ask an AI to)

A wallpaper is one self-contained `.html` file. The contract:

- Fill the viewport: `html,body{margin:0;height:100%;overflow:hidden}` and a `<canvas>` (or a monospace `<pre>`) sized to `innerWidth × innerHeight`; re-size on the `resize` event.
- Animate with `requestAnimationFrame` or `setInterval`; draw characters with `ctx.fillText` in a monospace font (that's what makes it "ASCII").
- It's **pointer-interactive**: `mousemove` / `pointerdown` / `wheel` fire when the cursor is over the bare desktop, so react to them (ripples, wake-up, parallax). Keyboard focus is off by design.
- WebGL is on; no network needed for local files. Any JS the page needs must be inline or bundled — no build step, no server.

`wallpapers/fluid.html` is the reference: a ~90-line stable-fluids sim (inject → advect → pressure-project) drawn as a character ramp, with ambient drift so it moves without a cursor. `matrix.html` is the 25-line minimum. Drop your file anywhere and `asciipaper set /path/to/it.html`, or add it to `wallpapers/` and `PRESETS` and send a PR.

Prompt that works: *"Write a single-file HTML live ASCII wallpaper for asciipaper: full-screen canvas, monospace fillText, animated with requestAnimationFrame, reacts to mousemove. Theme: ‹ocean waves›."*

## Add a preset

Edit `PRESETS` in `asciipaper`: `name: (url, selector)`. The selector (optional) is the element to isolate — everything else on the page is removed so the canvas fills the screen.

## Notes

- Single window, anchored to all edges — on multi-monitor setups it lands on the focused output. Set `LAYER_OUTPUT` if you need to pin it (see gtk4-layer-shell docs).
- Uses the compositor's `background` layer, so it sits under Omarchy's shell, bars and windows.

MIT
