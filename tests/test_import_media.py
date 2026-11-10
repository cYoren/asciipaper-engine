"""tools/import_media.py: a picture, GIF or video becomes a wallpaper the engine can render.

Run: python3 -m unittest discover -s tests -v      (skipped when ffmpeg is not installed)
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
TOOL = ROOT / "tools/import_media.py"
HAVE_FFMPEG = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


@unittest.skipUnless(HAVE_FFMPEG, "needs ffmpeg and ffprobe")
class ImportMediaTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="asciipaper-import-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def make(self, name, *args):
        path = self.tmp / name
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", *args, str(path)], check=True)
        return path

    def port(self, path):
        import_run = subprocess.run([sys.executable, str(TOOL), str(path), "-o", str(self.tmp / "out")],
                                    capture_output=True, text=True)
        self.assertEqual(import_run.returncode, 0, import_run.stderr)
        return self.tmp / "out"

    def frames_header(self, path):
        blob = path.read_bytes()
        self.assertEqual(blob[:4], b"APF1")
        width, height, count, fps = struct.unpack("<4I", blob[4:20])
        self.assertEqual(len(blob), 20 + width * height * 3 * count, "frames file size must match its header")
        return width, height, count, fps

    def test_a_still_picture_becomes_a_one_frame_wallpaper(self):
        picture = self.make("still.png", "-i", "testsrc2=s=800x600:d=1", "-frames:v", "1")
        out = self.port(picture)
        spec = json.loads((out / "still.json").read_text())
        self.assertEqual(spec["media"], "still.png")
        self.assertIn("cell", spec)
        self.assertIn("contrast", spec["uniforms"], "a ported picture needs a measured look")
        self.assertTrue(spec["charset"].startswith(" "), "charsets run from empty to dense")
        width, height, count, fps = self.frames_header(out / "still.png.frames")
        self.assertEqual(count, 1)
        self.assertEqual(fps, 0)
        self.assertLessEqual(width, 256, "frames are decoded at the character grid's own size")
        self.assertAlmostEqual(width / height, 800 / 600, places=1)
        self.assertTrue((out / "still.png").is_file(), "the web runtime plays the original media")

    def test_a_clip_becomes_a_loop_with_its_own_frame_rate(self):
        clip = self.make("clip.mp4", "-i", "testsrc2=s=640x360:d=2:r=10", "-pix_fmt", "yuv420p")
        out = self.port(clip)
        spec = json.loads((out / "clip.json").read_text())
        self.assertEqual(spec["media"], "clip.mp4")
        _, _, count, fps = self.frames_header(out / "clip.mp4.frames")
        self.assertGreater(count, 1)
        self.assertAlmostEqual(fps, 10_000, delta=1)

    def test_the_charset_name_comes_from_the_shared_catalog(self):
        ramps = json.loads((ROOT / "wallpapers/lib/looks.json").read_text())["charsets"]
        picture = self.make("still.png", "-i", "testsrc2=s=320x240:d=1", "-frames:v", "1")
        out = self.port(picture)
        self.assertEqual(json.loads((out / "still.json").read_text())["charset"], ramps["detailed"])

    def test_an_unknown_charset_is_refused(self):
        picture = self.make("still.png", "-i", "testsrc2=s=320x240:d=1", "-frames:v", "1")
        failed = subprocess.run([sys.executable, str(TOOL), str(picture), "-o", str(self.tmp / "out"), "--charset", "nope"],
                                capture_output=True, text=True)
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("unknown charset", failed.stderr)


if __name__ == "__main__":
    unittest.main()
