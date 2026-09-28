#!/bin/sh
set -e
cd "$(dirname "$0")"
if [ "$1" = uninstall ]; then
  systemctl --user disable --now asciipaper.service 2>/dev/null
  rm -rf ~/.local/bin/asciipaper ~/.local/bin/asciipaper-engine ~/.local/share/asciipaper/wallpapers ~/.config/systemd/user/asciipaper.service \
    ~/.local/share/applications/io.github.cyoren.asciipaper.desktop ~/.local/share/icons/hicolor/scalable/apps/io.github.cyoren.asciipaper.svg
  echo "asciipaper removed (config kept in ~/.config/asciipaper)"; exit 0
fi
# Runtime (WebKit for custom HTML wallpapers), then build tools for the native engine.
if command -v pacman >/dev/null; then sudo pacman -S --needed --noconfirm webkitgtk-6.0 python-gobject gtk4-layer-shell libadwaita ffmpeg \
  gcc make pkgconf wayland wayland-protocols libglvnd pango
elif command -v dnf >/dev/null; then sudo dnf install -y webkitgtk6.0 gtk4-layer-shell python3-gobject libadwaita ffmpeg-free \
  gcc make pkgconf wayland-devel wayland-protocols-devel libglvnd-devel pango-devel      # untested
elif command -v apt >/dev/null; then sudo apt install -y gir1.2-webkit-6.0 gir1.2-gtk4layershell-1.0 gir1.2-adw-1 python3-gi ffmpeg \
  gcc make pkg-config libwayland-dev wayland-protocols libegl-dev libgles-dev libpango1.0-dev  # untested
else echo "install manually: WebKitGTK 6.0, gtk4-layer-shell, libadwaita, PyGObject (with GI typelibs), ffmpeg"; fi
install -Dm755 asciipaper ~/.local/bin/asciipaper
# The native engine for the built-in presets. Without it everything still works, through WebKit.
if make -C native >/dev/null 2>&1; then install -Dm755 native/asciipaper-engine ~/.local/bin/asciipaper-engine
else echo "note: asciipaper-engine not built (missing build tools); built-in presets will use WebKit"; fi
mkdir -p ~/.local/share/asciipaper && cp -r wallpapers ~/.local/share/asciipaper/
install -Dm644 asciipaper.service ~/.config/systemd/user/asciipaper.service
install -Dm644 io.github.cyoren.asciipaper.desktop ~/.local/share/applications/io.github.cyoren.asciipaper.desktop
install -Dm644 io.github.cyoren.asciipaper.svg ~/.local/share/icons/hicolor/scalable/apps/io.github.cyoren.asciipaper.svg
systemctl --user daemon-reload
systemctl --user enable asciipaper.service
systemctl --user restart asciipaper.service
echo "asciipaper running. Open the Studio from your launcher, or: asciipaper --studio"
