#!/bin/sh
# Renders wallpapers/thumbnails/packs/NAME.jpg for every wallpaper in wallpapers/packs.json, with asciipaper itself,
# in a throwaway library. Run from the repo root after adding to a pack.
set -e
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" wallpapers/thumbnails/packs; printf '#!/bin/sh\n' > "$tmp/bin/systemctl"; chmod +x "$tmp/bin/systemctl"
export XDG_DATA_HOME="$tmp/data" XDG_CONFIG_HOME="$tmp/config" XDG_CACHE_HOME="$tmp/cache" PATH="$tmp/bin:$PATH"
for name in $(python3 -c "import json; print(' '.join(i['name'] for p in json.load(open('wallpapers/packs.json')) for i in p['items']))"); do
  added=$(./asciipaper add "$name" | sed -n 's/^Added //p')
  ./asciipaper render "$added" "$tmp/$name.png" --size 640x360 --seconds 4 >/dev/null
  ffmpeg -v error -y -i "$tmp/$name.png" -q:v 4 "wallpapers/thumbnails/packs/$name.jpg"
done
echo "wallpapers/thumbnails/packs: $(ls wallpapers/thumbnails/packs | wc -l) thumbnails"
