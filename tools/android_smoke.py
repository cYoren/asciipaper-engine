#!/usr/bin/env python3
"""Exercise editor persistence and the wallpaper service in an ephemeral emulator.

Launch a read-only AVD session first; this script changes only ASCII Paper's test
preferences and wallpaper selection. It refuses physical-device serial numbers.
Run: python3 tools/android_smoke.py emulator-5580 [--apk PATH]
"""
import argparse
import json
from pathlib import Path
import re
import subprocess
import time
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = "io.github.cyoren.asciipaper"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("serial")
    parser.add_argument("--adb", default=str(Path.home() / "Android/sdk/platform-tools/adb"))
    parser.add_argument("--apk", default=str(ROOT / "android/app/build/outputs/apk/debug/app-debug.apk"))
    parser.add_argument("--inspect", action="store_true", help="Show current UI labels/bounds without running the test")
    args = parser.parse_args()
    if not args.serial.startswith("emulator-"):
        parser.error("Use a temporary emulator, not a physical device")

    def adb(*command):
        result = subprocess.run([args.adb, "-s", args.serial, *command], text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=30)
        if result.returncode:
            raise RuntimeError(result.stdout[-1000:])
        return result.stdout

    def ui():
        path = "/data/local/tmp/asciipaper-ui.xml"
        adb("shell", "rm", "-f", path)
        result = adb("shell", "uiautomator", "dump", path)
        if "dumped to" not in result:
            raise RuntimeError(result)
        return ET.fromstring(adb("shell", "cat", path))

    def wait_ui(text):
        last = []
        for _ in range(5):
            try:
                tree = ui()
            except RuntimeError as error:
                last = [str(error).strip()]
                time.sleep(1)
                continue
            last = [n.get("text") for n in tree.iter("node") if n.get("text")]
            if text in last:
                return tree
            time.sleep(.5)
        raise AssertionError(f"UI element not ready: {text}; labels={last}")

    def center(node):
        x1, y1, x2, y2 = map(int, re.findall(r"\d+", node.get("bounds")))
        return str((x1 + x2) // 2), str((y1 + y2) // 2)

    def tap_text(tree, text):
        nodes = [n for n in tree.iter("node") if n.get("text") == text]
        if not nodes:
            raise AssertionError(f"UI element not found: {text}")
        adb("shell", "input", "tap", *center(nodes[0]))

    def preferences():
        tree = ET.fromstring(adb("shell", "run-as", PACKAGE, "cat", "shared_prefs/asciipaper.xml"))
        return {n.get("name"): n.text or n.get("value") for n in tree}

    def wait_shape(expected):
        for _ in range(10):
            try:
                saved = preferences()
                key = "look:" + saved.get("wallpaper", "synthwave") + ":" + saved.get("style", "characters")
                if json.loads(saved.get(key, "{}")).get("shape") == expected:
                    return key
            except RuntimeError:
                pass
            time.sleep(.5)
        raise AssertionError("Shape edit was not persisted")

    def launch():
        adb("shell", "am", "start", "-W", "-n", PACKAGE + "/.MainActivity")
        time.sleep(.5)

    if args.inspect:
        for n in ui().iter("node"):
            if n.get("text") or n.get("content-desc"):
                print(n.get("text") or n.get("content-desc"), n.get("class"), n.get("bounds"))
        return

    adb("install", "-r", args.apk)
    adb("shell", "input", "keyevent", "KEYCODE_WAKEUP")
    adb("shell", "wm", "dismiss-keyguard")
    adb("shell", "am", "force-stop", PACKAGE)
    launch()
    tree = wait_ui("Shape")
    # Select an actual alternate shape through the UI, then verify the renderer's
    # persisted input survives process death, not just Activity recreation.
    shapes = [n for n in tree.iter("node") if n.get("class") == "android.widget.Spinner"
              and any(c.get("text") in {"Glyph", "LEGO", "Pixel"} for c in n)]
    assert shapes, "Shape selector missing"
    target = "Glyph" if any(c.get("text") == "Pixel" for c in shapes[0]) else "Pixel"
    adb("shell", "input", "tap", *center(shapes[0]))
    time.sleep(.5)
    tree = wait_ui(target)
    tap_text(tree, target)
    key = wait_shape(target.lower())
    adb("shell", "am", "force-stop", PACKAGE)
    launch()
    assert json.loads(preferences()[key])["shape"] == target.lower(), "Saved look lost on restart"
    wait_ui(target)
    print("PASS: editor controls and look persistence across process restart", flush=True)

    tap_text(ui(), "Set as wallpaper")
    time.sleep(1)
    logs = adb("logcat", "-d", "-s", "asciipaper:E", "AndroidRuntime:E")
    assert not any(s in logs for s in ["can't draw", "shader:", "link:", "FATAL EXCEPTION"]), logs[-2000:]
    metrics = []
    for _ in range(10):
        dump = adb("shell", "dumpsys", "activity", "service", PACKAGE + "/.WallpaperService")
        metrics = [l.strip() for l in dump.splitlines() if "asciipaper frames=" in l]
        if any(re.search(r"frames=[1-9]\d*", l) and "drawing=true" in l for l in metrics):
            break
        time.sleep(.5)
    assert metrics, "Wallpaper renderer diagnostics unavailable"
    assert any(re.search(r"frames=[1-9]\d*", l) and "drawing=true" in l for l in metrics), metrics
    print("PASS: wallpaper preview renders with shared shaders; " + "; ".join(metrics), flush=True)
    adb("shell", "input", "keyevent", "KEYCODE_HOME")
    time.sleep(2)
    hidden = adb("shell", "dumpsys", "activity", "service", PACKAGE + "/.WallpaperService")
    metrics = [l.strip() for l in hidden.splitlines() if "asciipaper frames=" in l]
    # The preview engine may be destroyed after Home, which also satisfies pause.
    assert all("drawing=false" in l for l in metrics), metrics
    print("PASS: leaving the wallpaper preview stops drawing or destroys its engine", flush=True)


if __name__ == "__main__":
    main()
