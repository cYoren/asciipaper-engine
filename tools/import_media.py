#!/usr/bin/env python3
"""Turn a picture, GIF or video into an asciipaper media wallpaper, with ffmpeg.

    python3 tools/import_media.py photo.jpg -o out/
    ./native/asciipaper-engine --spec out/photo.json --lib wallpapers/lib --snapshot photo.png

Writes three files next to each other, which is all a media wallpaper is:

    out/photo.jpg           the original media, played by the web runtime
    out/photo.jpg.frames    RGB frames for the native engine ("APF1" header)
    out/photo.json          the spec: a look, measured from the picture, over the media shader

Why frames are small: the character grid is a few hundred cells wide, so 256 px is already
more detail than can be shown, and a whole clip stays in a few megabytes.
"""
import argparse
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRAME_WIDTH, MAX_FRAMES, MAX_FPS = 256, 600, 30
USER_AGENT = "asciipaper-engine (+https://github.com/cYoren/asciipaper-engine)"


def fail(message):
    sys.exit("import_media: " + message)


def need(tool, what):
    if not shutil.which(tool):
        fail(f"{what} needs {tool}. On Arch: sudo pacman -S ffmpeg; on Debian/Ubuntu: sudo apt install ffmpeg")


def download(url):
    need("ffmpeg", "reading a URL")
    name = Path(url.split("?")[0]).name or "media"
    target = Path(tempfile.mkdtemp(prefix="asciipaper-import-")) / name
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response, open(target, "wb") as out:
        shutil.copyfileobj(response, out)
    return target


def media_info(path):
    """(width, height, fps, frame count) — fps 0 for a still picture."""
    need("ffprobe", "reading media")
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                            "stream=width,height,avg_frame_rate,nb_frames:format=duration", "-of", "json", str(path)],
                           capture_output=True, text=True)
    try:
        info = json.loads(probe.stdout)
        stream = info["streams"][0]
        width, height = int(stream["width"]), int(stream["height"])
    except (ValueError, KeyError, IndexError):
        fail(f"can't read {path} as a picture, GIF or video")
    num, _, den = stream.get("avg_frame_rate", "0/1").partition("/")
    fps = float(num) / float(den or 1) if float(den or 1) else 0.0
    still = fps <= 0 or float(info.get("format", {}).get("duration") or 0) == 0 or stream.get("nb_frames") == "1"
    return width, height, (0.0 if still else min(fps, MAX_FPS)), (1 if still else None)


def decode(path, width, height, fps, count, frame_width=FRAME_WIDTH, max_frames=MAX_FRAMES):
    """RGB frames at the character grid's own resolution: 'APF1', u32 width, height, count, fps x 1000."""
    need("ffmpeg", "decoding media")
    w = max(2, min(frame_width, width) // 2 * 2)
    h = max(2, round(w * height / width / 2) * 2)
    filters = f"scale={w}:{h}:flags=area" + (f",fps={fps:.3f}" if fps else "")
    run = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-vf", filters, "-frames:v", str(count or max_frames),
                          "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True)
    frames = len(run.stdout) // (w * h * 3)
    if run.returncode or not frames:
        fail(f"ffmpeg could not decode {path}: {run.stderr.decode(errors='replace').strip()}")
    rgb = run.stdout[:frames * w * h * 3]
    return b"APF1" + struct.pack("<4I", w, h, frames, round(fps * 1000)) + rgb, (w, h, frames, fps)


def look(rgb):
    """A starting look, measured from the frames: 2nd..98th percentile luminance stretched to the
    full range, dense characters for the subject (inverting mostly-light grey pictures like
    sketches), and tint and background taken from the picture's own average colour."""
    step = max(1, len(rgb) // 3 // 20000) * 3          # ~20k samples is plenty
    samples = range(0, len(rgb) - 2, step)
    luma = sorted(0.299 * rgb[i] + 0.587 * rgb[i + 1] + 0.114 * rgb[i + 2] for i in samples)
    low, high = luma[len(luma) * 2 // 100] / 255, luma[len(luma) * 98 // 100] / 255
    contrast = min(4.0, 1 / max(high - low, 0.25))
    median = (luma[len(luma) // 2] / 255 - low) * contrast
    chroma = sum(max(rgb[i:i + 3]) - min(rgb[i:i + 3]) for i in samples) / len(samples) / 255
    mean = [sum(rgb[i + c] for i in samples) / len(samples) for c in range(3)]
    peak = max(mean) or 1
    hexed = lambda scale: "#" + "".join(f"{min(255, round(v / peak * scale)):02x}" for v in mean)
    uniforms = {"contrast": round(contrast, 2), "brightness": round(contrast * (0.5 - low) - 0.5, 2), "tint": hexed(255)}
    if median > 0.55 and chroma < 0.15:                # paper-like: sketches, line art, text on white
        uniforms["invert"] = 1
    return uniforms, hexed(18)


def charset(name):
    """A ramp from the shared catalog (wallpapers/lib/looks.json), so names and glyphs cannot drift."""
    ramps = json.loads((ROOT / "wallpapers/lib/looks.json").read_text())["charsets"]
    if name not in ramps:
        fail(f"unknown charset {name!r}; pick one of: {', '.join(ramps)}")
    return ramps[name]


def main():
    parser = argparse.ArgumentParser(description="Turn a picture, GIF, video or URL into a media wallpaper spec.")
    parser.add_argument("source", help="a file path, or an http(s) URL")
    parser.add_argument("-o", "--out", default=".", help="directory to write the spec, media and frames into (default: .)")
    parser.add_argument("--name", help="wallpaper name (default: the file's name, slugged)")
    parser.add_argument("--charset", default="detailed", help="character ramp from looks.json (default: detailed)")
    parser.add_argument("--cell", type=int, default=7, help="character cell height in pixels (default: 7)")
    parser.add_argument("--aspect", type=float, default=0.55, help="cell width / height (default: 0.55, monospace)")
    parser.add_argument("--frame-width", type=int, default=FRAME_WIDTH, help="decode width, in pixels (default: 256)")
    parser.add_argument("--max-frames", type=int, default=MAX_FRAMES, help="frame cap for clips (default: 600)")
    parser.add_argument("--fps", type=float, help="override the clip's frame rate")
    parser.add_argument("--json", action="store_true", help="print the spec instead of only the paths")
    args = parser.parse_args()

    ramps = charset(args.charset)

    url = re.match(r"https?://", args.source)
    source = download(args.source) if url else Path(args.source).expanduser()
    if not url and not source.is_file():
        fail(f"no such file: {args.source}")

    out = Path(args.out).expanduser()
    out.mkdir(parents=True, exist_ok=True)
    name = args.name or re.sub(r"[^a-z0-9]+", "-", source.stem.lower()).strip("-") or "ported"
    media = out / (name + (source.suffix.lower() or ".bin"))
    if source.resolve() != media.resolve():
        shutil.copyfile(source, media)
    if url:
        shutil.rmtree(source.parent, ignore_errors=True)

    width, height, fps, count = media_info(media)
    data, (w, h, frames, fps) = decode(media, width, height, args.fps or fps, count,
                                           args.frame_width, args.max_frames)
    (out / (media.name + ".frames")).write_bytes(data)

    uniforms, background = look(data[20:])
    spec = {"title": name.replace("-", " ").capitalize(), "media": media.name, "charset": ramps,
            "cell": args.cell, "aspect": args.aspect, "weight": 700, "fill": 0.25,
            "background": background, "uniforms": uniforms}
    spec_path = out / (name + ".json")
    spec_path.write_text(json.dumps(spec, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    size = f"{w}x{h}, {frames} frame{'s' if frames != 1 else ''}" + (f", {fps:g} fps" if fps else ", still")
    print(f"{spec_path}   ({size})", file=sys.stderr)
    rel = os.path.relpath(spec_path.resolve(), (ROOT / "wallpapers").resolve())
    if args.json:
        print(spec_path.read_text(), end="")
    else:
        print(f"{spec_path}\n{media}\n{media}.frames")
        print(f"\nsnapshot:  ./native/asciipaper-engine --spec {spec_path} --lib wallpapers/lib "
              f"--snapshot {out / (name + '.png')} --size 1920x1080 --seconds 3", file=sys.stderr)
        print(f"in a page: python3 -m http.server -d {ROOT} 8000  →  http://localhost:8000/wallpapers/run.html"
              f"?spec={rel}", file=sys.stderr)


if __name__ == "__main__":
    main()
