#!/usr/bin/env python3
"""Big text as a wallpaper: a word, a name, a few lines, drawn in characters.

    python3 tools/text_wallpaper.py "ASCII PAPER" -o out/
    python3 tools/text_wallpaper.py "one line\nand another" -o out/ --charset blocks

The text is drawn to a picture with ffmpeg and then ported like any other media (see
tools/import_media.py), so it gets the same measured look, the same styles, the same
pointer reaction and the same export paths as a photo. Nothing here is a special case
in the renderer.
"""
import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import import_media


def fail(message):
    sys.exit("text_wallpaper: " + message)


COLOURS = ("black", "white", "gray", "grey", "silver", "red", "green", "blue", "yellow",
           "orange", "purple", "violet", "cyan", "magenta", "pink", "brown", "navy", "teal")


def color(value, flag):
    """ffmpeg wants 0xRRGGBB, a person writes #rrggbb or one of the names below."""
    value = value.strip().lower()
    if re.fullmatch(r"#[0-9a-f]{6}", value):
        return "0x" + value[1:]
    if re.fullmatch(r"0x[0-9a-f]{6}", value) or value in COLOURS:
        return value
    fail(f"{flag} takes #rrggbb or one of: {', '.join(COLOURS)} (not {value!r})")


def fontfile(explicit=None):
    """A bold monospace font, from fontconfig when it is there; ffmpeg's default otherwise."""
    if explicit:
        return explicit
    match = shutil.which("fc-match")
    if match:
        found = subprocess.run([match, "-f", "%{file}", "monospace:bold"], capture_output=True, text=True).stdout.strip()
        if found:
            return found
    return None


def draw(text, target, size=(1920, 1080), fontsize=None, font=None, ink="0xffffff", paper="0x000000"):
    """Write the text as a picture: one line per '\\n', centred, wrapped nowhere."""
    import_media.need("ffmpeg", "drawing the text")
    width, height = size
    lines = text.splitlines() or [" "]
    if not fontsize:
        longest = max(len(line) for line in lines) or 1
        fontsize = int(min(height * 0.7 / len(lines), width * 1.5 / longest))
    fontsize = max(8, min(fontsize, height))
    work = Path(tempfile.mkdtemp(prefix="asciipaper-text-"))
    (work / "text.txt").write_text(text, encoding="utf-8")
    chosen = fontfile(font)
    style = "drawtext=textfile=" + str(work / "text.txt") + (f":fontfile='{chosen}'" if chosen else "") + \
            f":fontsize={fontsize}:fontcolor={ink}:x=(w-text_w)/2:y=(h-text_h)/2:line_spacing={(fontsize * 0.25):.0f}"
    run = subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color={paper}:s={width}x{height}",
                          "-frames:v", "1", "-vf", style, "-update", "1", str(target)], capture_output=True, text=True)
    shutil.rmtree(work, ignore_errors=True)
    if run.returncode or not Path(target).is_file():
        detail = run.stderr.strip() or "ffmpeg drew nothing"
        hint = " (no font: install one with fontconfig, or pass --font FILE.ttf)" if "fontfile" in detail else ""
        fail(f"couldn't draw the text: {detail}{hint}")


def main():
    parser = argparse.ArgumentParser(description="Draw big text as an asciipaper wallpaper.")
    parser.add_argument("text", help="the text; use \\n for line breaks")
    parser.add_argument("-o", "--out", default=".", help="directory to write into (default: .)")
    parser.add_argument("--name", help="wallpaper name (default: from the text)")
    parser.add_argument("--size", default="1920x1080", help="canvas the text is drawn on (default: 1920x1080)")
    parser.add_argument("--fontsize", type=int, help="in pixels (default: as large as fits)")
    parser.add_argument("--font", help="a .ttf/.otf path (default: the system's bold monospace)")
    parser.add_argument("--color", default="#ffffff", help="ink colour (default: #ffffff)")
    parser.add_argument("--background", default="#000000", help="paper colour (default: #000000)")
    parser.add_argument("--charset", default="detailed", help="character ramp from looks.json (default: detailed)")
    parser.add_argument("--cell", type=int, default=7, help="character cell height in pixels (default: 7)")
    parser.add_argument("--frame-width", type=int, default=1024,
                        help="width the text is sampled at (default: 1024; one still frame, and letters "
                             "need more resolution than a photo does)")
    parser.add_argument("--aspect", type=float, default=0.55, help="cell width / height (default: 0.55)")
    parser.add_argument("--json", action="store_true", help="print the spec instead of only the paths")
    args = parser.parse_args()

    match = re.fullmatch(r"(\d{2,5})x(\d{2,5})", args.size)
    if not match:
        fail("--size is WIDTHxHEIGHT, e.g. 1920x1080")
    text = args.text.replace("\\n", "\n").strip()
    if not text:
        fail("no text to draw")

    out = Path(args.out).expanduser()
    out.mkdir(parents=True, exist_ok=True)
    name = args.name or re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "text"
    picture = out / (name + ".png")
    draw(text, picture, size=(int(match[1]), int(match[2])), fontsize=args.fontsize, font=args.font,
         ink=color(args.color, "--color"), paper=color(args.background, "--background"))

    spec_path, media, frames, _ = import_media.port(
        picture, out, name=name, charset_name=args.charset, cell=args.cell, aspect=args.aspect,
        frame_width=args.frame_width, title=" ".join(text.split()))
    if args.json:
        print(spec_path.read_text(), end="")
    else:
        print(f"{spec_path}\n{media}\n{frames}")
        print(import_media.advice(spec_path), file=sys.stderr)


if __name__ == "__main__":
    main()
