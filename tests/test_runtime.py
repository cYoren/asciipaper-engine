"""Cross-platform renderer ABI and Android frame-policy checks.

Run: python3 -m unittest discover -s tests -v
Requires a JDK and glslangValidator (glslang-tools on Debian/Ubuntu).
"""
import ast
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest
import sys
import base64
import zlib

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from generate_runtime import resources


class RuntimeCompatibilityTest(unittest.TestCase):
    def test_committed_resources_are_current(self):
        # Native headers and Android assets must track the web implementation.
        for name, text in resources().items():
            with self.subTest(path=name):
                self.assertEqual(text, (ROOT / name).read_text(), "Run tools/generate_runtime.py")

    def test_native_and_android_shader_bytes_match(self):
        header = (ROOT / "native/shaders.h").read_text()
        for name in ("HEADER", "QUAD", "CELL_MAIN", "GLYPHS"):
            with self.subTest(shader=name):
                body = re.search(r"static const char " + name + r"\[\] =\n(.*?);\n", header, re.S)[1]
                native = "".join(ast.literal_eval(line.strip()) for line in body.splitlines())
                mobile = (ROOT / f"wallpapers/lib/shaders/{name.lower()}.glsl").read_text()
                self.assertEqual(native.rstrip("\n"), mobile.rstrip("\n"))

    def test_builtin_shaders_link_with_shared_passes(self):
        compiler = shutil.which("glslangValidator")
        self.assertIsNotNone(compiler, "Install glslangValidator to validate every bundled scene")
        lib = ROOT / "wallpapers/lib/shaders"
        with tempfile.TemporaryDirectory() as directory:
            vertex = Path(directory) / "scene.vert"
            fragment = Path(directory) / "scene.frag"
            vertex.write_text("#version 100\n" + (lib / "quad.glsl").read_text())
            fragments = {"glyph pass": (lib / "glyphs.glsl").read_text()}
            for path in sorted((ROOT / "wallpapers/specs").glob("*.json")):
                spec = json.loads(path.read_text())
                shader = spec["shader"]
                scene = shader if "cell(" in shader else (path.parent / shader).read_text()
                fragments[path.stem] = (lib / "header.glsl").read_text() + scene + (lib / "cell_main.glsl").read_text()
            for name, source in fragments.items():
                with self.subTest(scene=name):
                    fragment.write_text("#version 100\n" + source)
                    result = subprocess.run([compiler, "-l", str(vertex), str(fragment)], capture_output=True, text=True)
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_all_styles_fit_shared_shader_limits(self):
        catalog = json.loads((ROOT / "wallpapers/lib/looks.json").read_text())
        for name, style in catalog["styles"].items():
            with self.subTest(style=name):
                self.assertIn(style.get("shape", "glyph"), catalog["shapes"])
                self.assertIn(style.get("dither", "none"), catalog["dithers"])
                charset = style.get("charset", "classic")
                charset = catalog["charsets"].get(charset, charset)
                self.assertTrue(1 <= len(charset) <= 256)
                palette = style.get("palette", [])
                if isinstance(palette, str):
                    palette = catalog["palettes"][palette]
                self.assertLessEqual(len(palette), 16)
                for key, value in style.get("effects", {}).items():
                    low, high = catalog["effects"][key]
                    self.assertTrue(low <= value <= high)
