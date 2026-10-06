#!/bin/sh
# Rebuilds the website's live demos (docs/demos/) from the built-in wallpapers: one page per style,
# made by asciipaper itself in a throwaway library. Run from the repo root after changing looks or shaders.
set -e
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
export XDG_DATA_HOME="$tmp/data" XDG_CONFIG_HOME="$tmp/config" XDG_CACHE_HOME="$tmp/cache"
lib="$tmp/data/asciipaper/user-wallpapers"
rm -rf docs/demos && mkdir -p docs/demos && cp -r wallpapers/lib docs/demos/lib && cp wallpapers/fluid.html docs/demos/
for pair in characters:synthwave lego:synthwave crt:plasma gameboy:ocean cmyk:tunnel matrix-code:fire voxel:plasma \
            led:fire vaporwave:synthwave halftone:ocean pico8:tunnel glitch:plasma braille:tunnel disco:synthwave \
            noir:donut thermal:fire; do
  style=${pair%%:*} wallpaper=${pair#*:}
  name=$(./asciipaper look "$wallpaper" "$style" | sed -n 's/^Restyled \([^ ]*\).*/\1/p')
  cp "$lib/$name.html" "docs/demos/$style.html"
  rm "$lib/$name".*
done
echo "docs/demos: $(ls docs/demos/*.html | wc -l) pages"
