#!/bin/sh
set -e
cd "$(dirname "$0")"
sudo pacman -S --needed --noconfirm webkit2gtk-4.1 python-gobject gtk4-layer-shell
install -Dm755 asciipaper ~/.local/bin/asciipaper
install -Dm644 wallpapers/* -t ~/.local/share/asciipaper/wallpapers
install -Dm644 asciipaper.service ~/.config/systemd/user/asciipaper.service
systemctl --user daemon-reload
systemctl --user enable --now asciipaper.service
echo "asciipaper running. Change it with: asciipaper set <preset|url|file>"
