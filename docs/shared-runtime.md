# Shared runtime and portable projects

ASCII Paper keeps the existing JSON/GLSL specs and `asciipaper:v1:` appearance codes. A versioned `.asciipaper.json` project now carries the complete editable spec, embedded shader, and optional image/GIF/video. This unifies the data model without replacing the native Linux engine or the Windows host.

## Sources and hosts

`wallpapers/lib/asciipaper.js` owns the shared cell and glyph shader passes. `wallpapers/lib/looks.json` owns the 38 styles, shapes, dithers, palettes and character sets. `tools/generate_runtime.py` produces native headers, mobile shader assets, the 11-scene catalog and the four legacy simulation specs/adapters. Run it after changing a source; `--check` verifies freshness without modifying files. Builds reject stale outputs.

Linux and Android compile `native/presets.c`, including the same fluid, flow, matrix and yin-yang simulations. Web, Windows and Apple run their JavaScript equivalents through generated `wallpapers/lib/legacy.js`. Those simulation algorithms still have C and JavaScript implementations; changes to their behavior need both versions. Sharing a shader does not guarantee identical font rasterization across operating systems.

`studio/index.html`, `studio/studio.js` and `studio/portable-host.js` provide one editor for Windows, Android, Apple and browsers. Windows retains its filesystem bridge. Android uses a fixed local HTTPS asset origin and IndexedDB; Apple uses a restricted `paper://app/` scheme and native project storage. Only trusted app content receives native actions. User projects contain GLSL and data, never arbitrary HTML with a native bridge. Linux retains its GTK Studio and CLI; its import/export commands use the same project format.

## Project v1

```json
{
  "format": "asciipaper.project",
  "version": 1,
  "title": "My wallpaper",
  "spec": {"shader": "vec4 cell(vec2 uv){return vec4(uv,0.,1.);}", "cell": 8},
  "media": null
}
```

Media, when present, is `{ "name": "source.png", "mime": "image/png", "data": "BASE64" }`. Projects embed shaders up to 256 KiB and media up to 64 MiB. Media names cannot escape the project directory. Platform frame caches are excluded and regenerated on Linux. Imported GLSL is compiled as a GPU shader, not executed as JavaScript.

The Studio supports Import project, Save project, Save HTML, PNG capture with an embedded look code, text wallpapers and short video recording where the system WebView supports MediaRecorder. Appearance codes transfer appearance; full projects transfer shader and media. Files are exchanged explicitly: this is a local library, not automatic cloud synchronization.

On Linux:

```sh
asciipaper project export synthwave synthwave.asciipaper.json
asciipaper project import synthwave.asciipaper.json my-synthwave
```

The local MCP server also exposes `export_project` and `import_project`. It is a Linux stdio service; directory listing on [Glama](https://glama.ai/mcp/servers/cYoren/asciipaper) does not certify app stores or mobile feature parity.

## Android

The launcher opens the shared Studio with all 11 built-in scenes and saved custom projects. Choose local media or a direct HTTPS media link, edit its appearance, then open **Set wallpaper**, which uses Android's system live-wallpaper picker. PNG/JPEG/WebP and platform-supported images decode once; GIF frames reuse a small bitmap. Video uses MediaPlayer and SurfaceTexture with a GPU conversion pass, without reading every video frame back onto the CPU. Codec support depends on the device.

The renderer uses on-demand GLSurfaceView drawing. Defaults are 24 active fps and 12 idle fps after two seconds without input. Hidden, destroyed, screen-off and manually paused surfaces stop periodic callbacks. Battery saver and thermal states cap the rate. Video decoding follows engine visibility. Shader programs and the EGL context are reused when possible; look edits do not require decoding unchanged media again. Diagnostics are available with:

```sh
adb shell dumpsys activity service io.github.cyoren.asciipaper/.WallpaperService
```

These counters establish lifecycle behavior, not a minimum-energy guarantee. Measure CPU, GPU, decoder use and battery drain on physical devices before making an energy claim.

Use JDK 17 or 21 and an Android SDK to run `./gradlew assembleDebug lintDebug` from `android/`. Gradle installs the pinned NDK/CMake dependencies when necessary. The development APK is `android/app/build/outputs/apk/debug/app-debug.apk`.

Store bundles require a real signing identity. Set `ASCIIPAPER_RELEASE_STORE_FILE`, `ASCIIPAPER_RELEASE_STORE_PASSWORD`, `ASCIIPAPER_RELEASE_KEY_ALIAS` and `ASCIIPAPER_RELEASE_KEY_PASSWORD` in the build environment, then run `./gradlew bundleRelease`. Missing signing values or the default debug key alias fail before release packaging. Never commit signing credentials. Developer-account setup, listings, privacy declarations, device testing and store review remain release requirements. See [Android app signing](https://developer.android.com/studio/publish/app-signing).

## Apple

`apple/project.yml` defines iPhone/iPad (iOS 17+) and macOS (14+) app targets using the shared Studio and WKWebView. Generate the Xcode project with `xcodegen generate --spec apple/project.yml`. The Apple workflow builds both targets without signing; it does not archive, notarize or publish a store release.

The macOS host creates a desktop window per screen and pauses drawing for sleep and occlusion, with battery/thermal frame caps. iOS provides the editor, project library and exports. iOS does not expose an API for a third-party app to keep a continuous interactive renderer behind the home screen; system wallpaper selection remains in Settings. Apple's supported [Live Photo lock-screen behavior](https://support.apple.com/en-us/120734) is different from an Android live wallpaper. Store preparation must respect [Apple's public API and background-execution rules](https://developer.apple.com/app-store/review/guidelines/).

Apple signing/team configuration, icons and store metadata, physical-device WebKit/media testing and review are still required. Native Metal is not needed to start these targets; the current renderer uses WebKit's GPU backend. A dedicated backend should follow measured performance needs.

## Verification

Run `python3 -m unittest discover -s tests -v` with Python, Node, a JDK, a C compiler and `glslangValidator`. Checks cover generated resources, GLSL ES linking, shader-byte agreement, recipes, portable project compatibility, large media payloads, frame policy and simulation lifecycles under AddressSanitizer/UBSan.

`node tools/studio_smoke.mjs` uses a temporary Chromium profile to check project persistence, visible GPU output, capture and hidden-preview pause. For an isolated Android emulator, install the debug APK, enable WebView debugging, forward its DevTools socket and set `PAPER_CDP_ENDPOINT`, `ANDROID_SERIAL=emulator-PORT`, and `ADB` when running the same script. This also checks all 11 native scenes, PNG/GIF/video imports and leaving the live-wallpaper preview. It must not target a user's phone.

CI runs the shared checks and Android build/lint, Windows builds and screenshot self-tests on two Windows images, and unsigned iOS/macOS builds. Device power measurements and signed store acceptance are separate from build success.
