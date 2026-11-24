"""A still PNG is a wallpaper: no frame cache, and the same picture as the cached path.

An atlas wallpaper (asciimagic) is read one texel a cell, so nothing may resample it: the frame
cache resamples nothing, but a 1728x1512 atlas costs 7.8 MB of cache for one image. The engine
reads the PNG itself, and this test holds that path to the cached one, byte for byte.
"""
import json
import struct
import subprocess
import tempfile
import unittest
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENGINE = ROOT / "native/asciipaper-engine"
LIB = ROOT / "wallpapers/lib"

SPEC = {
    "title": "still", "shader": "probe.glsl", "media": "still.png", "frameWidth": 64,
    "charset": " .:-=+*#%@", "cell": 8, "aspect": 0.55, "background": "#05070a",
    "interaction": {"mode": "none"}, "dither": 0,
    "uniforms": {"fit": 0, "zoom": 1},
}
PROBE = """// defaults: {"fit": 0, "zoom": 1}
uniform sampler2D media;
uniform vec2 mediaSize;
uniform float fit, zoom;
vec4 cell(vec2 uv){
  vec2 size = mediaSize;
  float s = fit > 0.5 ? max(u_grid.x/size.x, u_grid.y/size.y) : min(u_grid.x/size.x, u_grid.y/size.y);
  vec2 p = (uv*u_grid - (u_grid - size*s)*0.5)/max(s*zoom, 1e-4);
  if(p.x < 0.0 || p.y < 0.0 || p.x >= size.x || p.y >= size.y) return vec4(0.0);
  vec4 c = texture2D(media, (floor(p) + 0.5)/mediaSize);
  return vec4(c.rgb, c.r > 0.25 ? 1.0 : 0.0);
}
"""


def png(width, height, rgb, alpha=None):
    """An 8-bit PNG, no interlace: RGB (colour type 2), or RGBA (type 6) when alpha bytes are given."""
    if alpha is None:
        depth, pixels = 3, rgb
    else:
        depth, joined = 4, bytearray()
        for i in range(0, len(rgb), 3):
            joined += rgb[i:i + 3] + alpha[i // 3:i // 3 + 1]
        pixels = bytes(joined)
    stride = width * depth
    raw = b"".join(b"\x00" + pixels[y * stride:(y + 1) * stride] for y in range(height))

    def chunk(tag, body):
        return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)

    head = struct.pack(">IIBBBBB", width, height, 8, 2 if alpha is None else 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", head) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def frames(width, height, rgb):
    """The cache the engine reads next to a media file: APF1, then the RGB frames."""
    return b"APF1" + struct.pack("<4I", width, height, 1, 1000) + rgb


class StillSpecTest(unittest.TestCase):
    def setUp(self):
        if not ENGINE.exists():
            self.skipTest("build the engine first: make")
        self.folder = tempfile.TemporaryDirectory()
        self.dir = Path(self.folder.name)
        width, height = 64, 48
        pixels = bytearray()
        for y in range(height):
            for x in range(width):
                pixels += bytes((x * 4 % 256, y * 5 % 256, 90 if (x // 8 + y // 8) % 2 else 200))
        self.image = png(width, height, bytes(pixels))
        self.cache = frames(width, height, bytes(pixels))
        (self.dir / "probe.glsl").write_text(PROBE)
        (self.dir / "still.json").write_text(json.dumps(SPEC))

    def tearDown(self):
        self.folder.cleanup()

    def render(self, name):
        done = subprocess.run([str(ENGINE), "--spec", str(self.dir / "still.json"), "--lib", str(LIB),
                               "--snapshot", str(self.dir / name), "--seconds", "1", "--size", "320x240"],
                              capture_output=True, text=True)
        if "no offscreen OpenGL ES 2" in done.stderr:
            self.skipTest("no EGL surfaceless here")
        return (self.dir / name).read_bytes() if (self.dir / name).exists() else b""

    def test_a_png_plays_without_a_cache(self):
        (self.dir / "still.png").write_bytes(self.image)
        self.assertFalse((self.dir / "still.png.frames").exists())
        rendered = self.render("png.png")
        self.assertTrue(rendered, "no snapshot")
        (self.dir / "still.png.frames").write_bytes(self.cache)
        cached = self.render("cache.png")
        self.assertEqual(rendered, cached, "the PNG path and the frame cache must render the same frame")

    def test_a_translucent_png_is_un_premultiplied(self):
        # cairo hands back premultiplied ARGB; half-covering pixels are where that conversion can be
        # wrong without anything looking broken.
        width, height = 8, 4
        rgb_, alpha = bytearray(), bytearray()
        for y in range(height):
            for x in range(width):
                rgb_ += bytes((200, 60, 20))
                alpha.append(200)
        (self.dir / "still.png").write_bytes(png(width, height, bytes(rgb_), bytes(alpha)))
        spec = json.loads((self.dir / "still.json").read_text())
        spec["charset"] = " █"
        (self.dir / "still.json").write_text(json.dumps(spec))
        rendered = self.render("alpha.png")
        self.assertTrue(rendered, "no snapshot")
        cached = self.render_with_cache(width, height, bytes(rgb_), bytes(alpha))
        self.assertTrue(cached, "no cache snapshot")
        # Straight RGB comes back from premultiplied ARGB to within a unit a channel, and the encoder
        # is not the thing under test: compare the fraction of bytes that moved.
        differing = sum(1 for a, b in zip(rendered, cached) if a != b) / max(len(rendered), 1)
        self.assertLess(differing, 0.02, f"{differing:.1%} of bytes differ: the premultiplied alpha maths is off")

    def test_a_corrupt_cache_falls_back_to_the_png(self):
        (self.dir / "still.png").write_bytes(self.image)
        (self.dir / "still.png.frames").write_bytes(b"APF1" + b"\x01\x02")   # too short to be a cache
        rendered = self.render("corrupt.png")
        self.assertTrue(rendered)
        self.assertEqual(rendered, self.render("plain.png"))

    def render_with_cache(self, width, height, rgb_, alpha=None):
        (self.dir / "still.png").write_bytes(png(width, height, rgb_, alpha))
        (self.dir / "still.png.frames").write_bytes(frames(width, height, rgb_))
        return self.render("cached-alpha.png")

    def test_a_media_file_it_cannot_read_says_so(self):
        (self.dir / "still.png").write_bytes(b"not a picture")
        done = subprocess.run([str(ENGINE), "--spec", str(self.dir / "still.json"), "--lib", str(LIB),
                               "--snapshot", str(self.dir / "broken.png"), "--seconds", "1", "--size", "64x64"],
                              capture_output=True, text=True)
        self.assertIn("no frames for", done.stderr)


if __name__ == "__main__":
    unittest.main()
