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
asciipaper set fluid            # asciify.org fluid (default)
asciipaper set matrix           # bundled, offline
asciipaper set https://…        # any page
asciipaper set ~/my/rain.html   # any local file
```

`set` saves to `~/.config/asciipaper/wallpaper` and restarts the service. Run `asciipaper <target>` directly to try one without saving.

## Add a preset

Edit `PRESETS` in `asciipaper`: `name: (url, selector)`. The selector (optional) is the element to isolate — everything else on the page is removed so the canvas fills the screen.

## Notes

- Single window, anchored to all edges — on multi-monitor setups it lands on the focused output. Set `LAYER_OUTPUT` if you need to pin it (see gtk4-layer-shell docs).
- Uses the compositor's `background` layer, so it sits under Omarchy's shell, bars and windows.

MIT
