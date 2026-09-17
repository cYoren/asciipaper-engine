#!/bin/sh
set -e
cd "$(dirname "$0")"
if [ "$1" = uninstall ]; then
  systemctl --user disable --now asciipaper.service 2>/dev/null
  rm -rf ~/.local/bin/asciipaper ~/.local/share/asciipaper ~/.config/systemd/user/asciipaper.service
  echo "asciipaper removed (config kept in ~/.config/asciipaper)"; exit 0
fi
sudo pacman -S --needed --noconfirm webkitgtk-6.0 python-gobject gtk4-layer-shell
install -Dm755 asciipaper ~/.local/bin/asciipaper
mkdir -p ~/.local/share/asciipaper && cp -r wallpapers ~/.local/share/asciipaper/
install -Dm644 asciipaper.service ~/.config/systemd/user/asciipaper.service
systemctl --user daemon-reload
systemctl --user enable --now asciipaper.service
echo "asciipaper running. Change it with: asciipaper set <preset|url|file>"
