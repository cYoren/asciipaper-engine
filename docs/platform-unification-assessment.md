**ASCII Paper: five-platform assessment — 7 October 2026**

Reviewed the local repository at commit `682caf2`, including yesterday’s Android implementation. This is a source-code and documentation assessment, not a device benchmark or a store submission. No application code was changed.

**We do not need a complete remake. We do need a deliberate architectural consolidation.** The existing shader specs, styles, effects, media pipeline and desktop tools are valuable. Android currently implements a small subset of the product. macOS has an export-based integration, and iOS has no implementation. Continuing to add features independently to each platform would make the “separate islands” problem worse.

**Where we stand**

| Capability | Linux | Windows | Android | macOS | iOS |
|---|---|---|---|---|---|
| Dedicated ASCII Paper app | Yes; Python/GTK Studio and C wallpaper engine | Yes; C#/WinForms host and web Studio | Yes; Java picker and GLES renderer | No; exported wallpapers opened in Plash | No |
| Built-in scenes | Four older scenes plus seven shader presets | Four older scenes plus seven shader presets | Seven shader presets only | Exported scenes through Plash | Absent |
| 38 styles | Yes | Yes | Yes, through preset selection | Available in exported content; no ASCII Paper Studio | Absent |
| Fine editing of looks and scene parameters | Yes | Yes | No editing UI beyond wallpaper/style selection | Requires creating/editing elsewhere | Absent |
| Import pictures, GIFs and videos | Yes | Yes; browser decoding determines actual format support | Absent | Can play exported media wallpapers | Absent |
| Custom library, shader projects and saved edits | Yes | Yes | Absent from the app’s user workflow | Export consumption only | Absent |
| Portable look recipes | Yes | Yes | Absent from UI | No dedicated editor | Absent |
| Interactive wallpaper export ZIP | Yes | Yes | Absent | Consumes exports | Absent |
| Recorded video/GIF export | Yes, through native engine and FFmpeg | No equivalent recording command in the Studio bridge | Absent | No dedicated implementation | Absent |
| Runtime energy controls | Active/idle frame rates, quality and pause mechanisms | Active/idle frame rates, quality, covered-screen/lock pause | Hidden pause; fixed visible frame interval | Controlled by Plash | Absent |

Android discovers only `wallpapers/specs/*.json`: **donut, fire, ocean, plasma, starfield, synthwave and tunnel**. It does not offer **fluid, flow, matrix or yin-yang**. Those four are implemented through older HTML scenes and native presets. Bundling the wallpaper directory does not make Android’s renderer capable of running every file in it. The recent commit’s “every built-in wallpaper” description therefore overstates coverage.

Evidence: [Android scene discovery](../android/app/src/main/java/io/github/cyoren/asciipaper/Look.java#L45), [Android picker](../android/app/src/main/java/io/github/cyoren/asciipaper/MainActivity.java#L60), [Windows scene list](../windows/Library.cs#L26), [Windows Studio commands](../windows/StudioWindow.cs#L94), [Linux recording](../asciipaper#L660), and [current macOS installation instructions](../README.md#L29).

**What is already shared, and what is fragmented**

The seven JSON/GLSL scene specs and `wallpapers/lib/looks.json` are already common assets. The catalog contains 38 styles, 21 character sets, 13 shapes, 20 palettes, 12 ordered dithers, four diffusion choices, 11 effects and eight warps. Those counts describe the catalog; they do not prove that every combination works identically in every renderer.

Android reads its rendering shader strings directly out of `wallpapers/lib/asciipaper.js`. Windows renders through WebView2 and uses the web Studio. This is meaningful reuse, although extracting shader strings from JavaScript text at runtime is a fragile interface.

The Linux engine contains manually copied shader strings. Older scene behavior exists in both HTML/JavaScript and `native/presets.c`. Project parsing, style application, file management and editing behavior also live in separate Python, C#, Java and JavaScript implementations. Linux uses its GTK Studio; Windows uses `studio/studio.js`; Android has its own small picker.

The main architectural debt is **duplicated product behavior without a common compatibility contract**. Multiple native platform hosts are expected and useful. They should not each define independently what a project or a style means.

Evidence: [shared catalog](../wallpapers/lib/looks.json), [Android shader extraction](../android/app/src/main/java/io/github/cyoren/asciipaper/Look.java#L135), [native shader copies](../native/engine.c#L39), and [documented duplicate legacy scenes](../README.md#L181).

**The architecture I recommend**

Keep the repository and migrate incrementally toward one product definition:

1. **One versioned project format.** Define scenes, media references, uniforms, style parameters, interaction behavior and required capabilities. Add a portable project package containing the project and its assets. Existing HTML export ZIPs are playback exports; they are not yet a general editable project exchange format. Look recipes are useful but do not carry an entire media project.
2. **One source for rendering behavior.** Move shader sources into explicit shared files and generate backend resources at build time. Define a portable scene interface for the four older built-ins, including simulation and pointer behavior. Isolate platform-independent rendering and project logic from Linux’s Wayland/Pango host before reusing it elsewhere. Plan a Metal backend for Apple platforms; do not manually maintain another independent set of scene implementations.
3. **One shared editing model and command contract.** Import, edit, apply style, save, preview, export and exchange projects should have the same semantics everywhere. Generate controls from common parameter metadata where practical. Native file pickers, media codecs and wallpaper integration belong in platform adapters. A common model does not require every screen to look identical.
4. **One compatibility suite.** Use the same project fixtures on all platforms: catalog discovery, style application, project round trips, media imports and rendered reference frames. Allow reasonable font/GPU differences. Run lifecycle and energy checks on actual devices.

The portable core can be extracted from existing work. Choosing a replacement UI framework now would not by itself unify the renderers, project storage or feature semantics. Avoid making that choice the prerequisite for fixing Android’s missing tools.

Browser rendering remains useful for web demos, exports and HTML compatibility. Treat arbitrary HTML as an explicit compatibility mode with its own performance expectations; do not promise the native renderer’s energy budget for arbitrary web content.

Portable files make the apps interoperable. Automatic library synchronization is a separate feature and is not currently implemented by this architecture.

**Can we ship Android and iOS in the stores?**

**Android: yes, there is a viable path from the existing app.** The platform has a supported live-wallpaper service, and this implementation already uses it. The immediate packaging blocker is `release.signingConfig = signingConfigs.debug`. Google Play does not accept debug-signed applications for publishing. Prepare a release-signed Android App Bundle and configure Play App Signing, then complete device testing, listing materials and the required Play Console declarations. The project already targets API 36; check the applicable target requirement again at submission time. [Current build configuration](../android/app/build.gradle#L18), [Android signing guidance](https://developer.android.com/studio/publish/app-signing), [Play app setup](https://support.google.com/googleplay/android-developer/answer/9859152).

**iOS: yes as an ASCII Paper creation/editor/export app, subject to review.** It can have the common scene library, styles, media importing, saved projects, interactive previews and exports. It cannot offer an Android-style continuously running third-party shader wallpaper service on the Home Screen. The practical wallpaper route is still images and eligible Live Photo exports that the user selects through Apple’s wallpaper UI. Apple documents Live Photo playback on the Lock Screen when the device wakes. Generating a photo/video pair is not sufficient proof of wallpaper eligibility; validate exported Live Photos on supported iPhones. [Apple’s wallpaper workflow](https://support.apple.com/en-us/120734).

The iOS implementation needs to be built: an Apple app target, rendering integration, file/photo access, export flow, signing and TestFlight validation. Use public APIs and supported background behavior. Apple’s review rules restrict background-service use and alternate Home Screen environments. These constraints shape the product; they are not a consequence of choosing the wrong infrastructure. [App Review Guidelines, sections 2.5.1, 2.5.4 and 2.5.8](https://developer.apple.com/app-store/review/guidelines/).

For a new Apple renderer, prefer Metal. Apple deprecated OpenGL ES in iOS 12 and directs developers toward Metal. Preserving our scene definitions is compatible with adding a different graphics backend. [Apple graphics guidance](https://developer.apple.com/library/archive/documentation/3DDrawing/Conceptual/OpenGLES_ProgrammingGuide/Introduction/Introduction.html).

For macOS, a dedicated ASCII Paper editor and wallpaper host would replace today’s dependence on another app. Desktop integration needs its own macOS prototype and validation; it is not already delivered by the existing exporter.

**Can it use the minimum possible battery and CPU?**

We can make efficiency a measurable release requirement. We cannot honestly guarantee an absolute minimum, and we do not have evidence that the current five-platform product meets such a target. CPU percentage alone omits GPU work, video decoding, memory bandwidth and display energy. Continuous animation necessarily costs more energy than a still wallpaper.

There are good foundations: GPU rendering, a low-resolution character-cell pass, Linux active/idle rates, Windows covered-screen/lock pause and Android visibility pause. Android’s lifecycle follows the platform’s documented instruction to use CPU only while visible. [Android lifecycle guidance](https://developer.android.com/reference/android/service/wallpaper/WallpaperService.Engine).

Specific remaining work:

- Android requests a frame every 33 ms while visible, regardless of interaction. Add active/idle pacing, quality settings, power-saver behavior and thermal response.
- Android’s in-app preview uses GLSurfaceView’s default continuous rendering mode and has no explicit frame cap. Give it the same energy policy as the wallpaper renderer.
- The glyph/effects pass still runs at the full surface size. Limit resolution and expensive effects where measurements justify it; low cell count alone does not eliminate GPU cost.
- Suspend simulation and video decoding as well as drawing when hidden. Test screen-off, app backgrounding, launcher transitions, surface recreation and concurrent preview/wallpaper engines.
- Cache atlases, programs and static results. For genuinely static scenes, render on changes rather than keeping an animation timer alive.
- Offer hardware-decoded rendered loops for scenes that do not need interaction, and measure them against procedural rendering. Video is not automatically cheaper in every case.

Evidence: [Android wallpaper pacing and pause](../android/app/src/main/java/io/github/cyoren/asciipaper/WallpaperService.java#L33), [Android preview setup](../android/app/src/main/java/io/github/cyoren/asciipaper/MainActivity.java#L50), [full-size glyph pass](../android/app/src/main/java/io/github/cyoren/asciipaper/Renderer.java#L100), [Windows pause](../windows/WallpaperWindow.cs#L116), and [Linux scheduling](../native/engine.c#L813).

The README reports approximately 0.5–0.6% CPU and 110 MB for some Linux scenes at 9 fps on one Intel laptop, and 2.7% CPU for the CPU-simulated flow scene. These are historical project claims, not measurements reproduced in this assessment. They cannot establish Android battery consumption, Windows resource use or Apple performance. [Recorded measurements](../README.md#L170).

Set acceptance targets before optimizing: no periodic rendering/decoding while hidden; bounded active and idle frame rates; no sustained thermal throttling; and measured CPU, GPU time, memory and energy at matched visual quality. Compare against a static wallpaper and the platform baseline on representative phones and computers. Publish results with device, scene, resolution, effects and frame rate specified. I found Windows screenshot self-test infrastructure, but no cross-platform parity suite or energy benchmark in the tracked repository.

**A practical order of work**

1. Establish the feature contract, versioned project format and shared fixtures. Correct the documented platform coverage.
2. Give Android the full editing workflow: media import, custom projects, fine controls, recipes and project exchange. Port the four missing scenes through the shared scene contract. Add frame pacing and power controls alongside this work.
3. Extract and unify rendering/project behavior while keeping Linux and Windows working. Replace runtime shader extraction and manual shader copies with generated resources.
4. Build an Apple rendering/export prototype early enough to validate Metal and Live Photo eligibility. Develop the iOS editor and a dedicated macOS host against the same project contract.
5. Complete platform parity checks, physical-device energy measurements and store packaging. Release features against shared acceptance criteria so new platforms cannot silently become reduced editions again.

This preserves the working product while making “one big island” concrete: the same projects, creative tools and scene behavior across five platforms, with wallpaper delivery adapted to what each operating system supports.
