"""tools/text_wallpaper.py: big text becomes a wallpaper through the same port as a picture.

Run: python3 -m unittest discover -s tests -v      (skipped without ffmpeg's drawtext filter)
"""
import json
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools/text_wallpaper.py"


def drawtext_available():
    if not shutil.which("ffmpeg"):
        return False
    filters = subprocess.run(["ffmpeg", "-hide_banner", "-filters"], capture_output=True, text=True).stdout
    return "drawtext" in filters


@unittest.skipUnless(drawtext_available(), "needs ffmpeg with the drawtext filter")
@unittest.skipUnless(shutil.which("fc-match"), "needs fontconfig for a font to draw with")
class TextWallpaperTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="asciipaper-text-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def run_tool(self, text, *extra):
        return subprocess.run([sys.executable, str(TOOL), text, "-o", str(self.tmp / "out"), *extra],
                              capture_output=True, text=True)

    def test_text_becomes_a_one_frame_media_wallpaper(self):
        run = self.run_tool("ASCII PAPER")
        self.assertEqual(run.returncode, 0, run.stderr)
        out = self.tmp / "out"
        spec = json.loads((out / "ascii-paper.json").read_text())
        self.assertEqual(spec["title"], "ASCII PAPER")
        self.assertEqual(spec["media"], "ascii-paper.png")
        self.assertIn("contrast", spec["uniforms"])
        frames = (out / "ascii-paper.png.frames").read_bytes()
        self.assertEqual(frames[:4], b"APF1")
        width, height, count, fps = struct.unpack("<4I", frames[4:20])
        self.assertEqual(count, 1, "text is a still, so one frame is enough")
        self.assertEqual(fps, 0)
        self.assertEqual(len(frames), 20 + width * height * 3)
        self.assertGreaterEqual(width, 512, "letters need more than a photo's sampling width")

    def test_line_breaks_and_a_custom_charset(self):
        run = self.run_tool("one\\ntwo", "--charset", "blocks", "--name", "two-lines")
        self.assertEqual(run.returncode, 0, run.stderr)
        spec = json.loads((self.tmp / "out/two-lines.json").read_text())
        self.assertEqual(spec["title"], "one two")
        self.assertEqual(spec["charset"], " ░▒▓█")

    def test_a_bad_size_or_colour_is_refused(self):
        self.assertIn("--size", self.run_tool("hi", "--size", "big").stderr)
        self.assertIn("--color", self.run_tool("hi", "--color", "nope").stderr)


if __name__ == "__main__":
    unittest.main()
