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

    def test_android_frame_policy(self):
        java, javac = shutil.which("java"), shutil.which("javac")
        self.assertIsNotNone(java, "Install a JDK")
        self.assertIsNotNone(javac, "Install a JDK")
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run([javac, "-d", directory,
                str(ROOT / "android/app/src/main/java/io/github/cyoren/asciipaper/FramePolicy.java"),
                str(ROOT / "tests/FramePolicyTest.java")], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            result = subprocess.run([java, "-cp", directory, "io.github.cyoren.asciipaper.FramePolicyTest"], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


class RecipeCompatibilityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.directory.cleanup)
        result = subprocess.run(["javac", "--release", "17", "-d", cls.directory.name,
            str(ROOT / "android/app/src/main/java/io/github/cyoren/asciipaper/Recipe.java"),
            str(ROOT / "tests/RecipeCodec.java")], capture_output=True, text=True)
        if result.returncode:
            raise AssertionError(result.stdout + result.stderr)
        # Load the real Linux encoder/decoder without importing the GTK app or
        # touching its user library/configuration.
        source = ast.parse((ROOT / "asciipaper").read_text())
        definitions = [node for node in source.body if isinstance(node, ast.FunctionDef)
                       and node.name in {"encode_recipe", "decode_recipe"}]
        constants = {}
        for node in source.body:
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name) and target.id in {"RECIPE", "LOOK_KEYS"}:
                        constants[target.id] = ast.literal_eval(node.value)
        cls.desktop = {"json": json, "zlib": zlib, **constants, "spec_shader": lambda spec, base: (spec["shader"], {})}
        exec(compile(ast.Module(body=definitions, type_ignores=[]), "desktop recipe functions", "exec"), cls.desktop)
        cls.fixture = {"charset": " ░▒▓█⠁⠃⠇", "cell": 12, "aspect": .55, "shape": "glyph", "palette": ["#123456", "#fedcba"],
            "effects": {"bloom": .25, "hue": -.15}, "uniforms": {"speed": 1.25},
            "shader": "// defaults: {\"speed\":1}\nuniform float speed;\nvec4 cell(vec2 uv){return vec4(uv,0.0,1.0);}"}

    def java(self, action, value):
        return subprocess.run(["java", "-cp", self.directory.name, "io.github.cyoren.asciipaper.RecipeCodec", action],
                              input=value, capture_output=True, text=True)

    def test_android_code_is_readable_by_desktop(self):
        result = self.java("encode", json.dumps(self.fixture, ensure_ascii=False))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.desktop["decode_recipe"](result.stdout), self.fixture)

    def test_desktop_code_is_readable_by_android(self):
        code = self.desktop["encode_recipe"](self.fixture, ROOT)
        result = self.java("decode", code)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), self.fixture)

    def test_invalid_or_oversized_codes_are_rejected(self):
        bomb = "asciipaper:v1:" + base64.urlsafe_b64encode(zlib.compress(b"x" * (256 * 1024 + 1))).decode().rstrip("=")
        for code in ["asciipaper:v2:abc", "asciipaper:v1:!", "asciipaper:v1:eA", bomb]:
            with self.subTest(code=code[:30]):
                self.assertNotEqual(self.java("decode", code).returncode, 0)


if __name__ == "__main__":
    unittest.main()
