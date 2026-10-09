using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace Asciipaper;

// The running app: wallpapers on every monitor, the tray icon, settings, and the Studio on demand.
sealed class App : ApplicationContext
{
    public static readonly Icon AppIcon = new(typeof(App).Assembly.GetManifestResourceStream("asciipaper.ico"));
    static readonly string ConfigFile = Path.Combine(Library.Root, "config.json");
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";

    public CoreWebView2Environment Environment;
    readonly List<WallpaperWindow> wallpapers = new();
    readonly NotifyIcon tray = new() { Icon = AppIcon, Text = "asciipaper", Visible = true };
    readonly ToolStripMenuItem pauseItem = new("Pause wallpaper");
    readonly WindowsFormsSynchronizationContext ui = new();
    readonly System.Windows.Forms.Timer coverTimer = new() { Interval = 1000 }, specTimer = new() { Interval = 300 };
    readonly Native.LowLevelMouseProc mouseProc;
    readonly MessageWindow messages;
    readonly FileSystemWatcher watcher;
    Dictionary<string, object> config;
    StudioWindow studio;
    IntPtr hook, worker;
    bool locked;
    WallpaperWindow pointerOn;
    int lastMove;

    public App(bool showStudio, string selftest)
    {
        mouseProc = MouseHook;
        messages = new MessageWindow(() => ui.Post(_ => Reattach(), null));
        config = LoadConfig(out bool firstRun);
        if (firstRun) Autostart = true;

        var menu = new ContextMenuStrip();
        var open = new ToolStripMenuItem("Open asciipaper", null, (_, _) => OpenStudio());
        open.Font = new Font(open.Font, FontStyle.Bold);
        pauseItem.Click += (_, _) => SetPaused(!Paused);
        menu.Items.AddRange(new ToolStripItem[] { open, pauseItem, new ToolStripSeparator(), new ToolStripMenuItem("Quit", null, (_, _) => Quit()) });
        tray.ContextMenuStrip = menu;
        tray.DoubleClick += (_, _) => OpenStudio();

        coverTimer.Tick += (_, _) => UpdatePause();
        specTimer.Tick += (_, _) => { specTimer.Stop(); SpecChanged(Current); };
        watcher = new FileSystemWatcher(Library.Folder) { NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName, EnableRaisingEvents = true };
        FileSystemEventHandler changed = (_, e) => ui.Post(_ => { if (WatchedFile(e.Name)) { specTimer.Stop(); specTimer.Start(); } }, null);
        watcher.Changed += changed; watcher.Created += changed;
        watcher.Renamed += (_, e) => changed(null, e);
        SystemEvents.DisplaySettingsChanged += (_, _) => ui.Post(_ => { _ = Rebuild(); }, null);
        SystemEvents.SessionSwitch += (_, e) =>
        {
            locked = e.Reason is SessionSwitchReason.SessionLock or SessionSwitchReason.ConsoleDisconnect or SessionSwitchReason.RemoteDisconnect;
            ui.Post(_ => UpdatePause(), null);
        };
        Listen(@"Local\asciipaper-show", OpenStudio);
        Listen(@"Local\asciipaper-quit", Quit);

        var start = new System.Windows.Forms.Timer { Interval = 1 };
        start.Tick += async (_, _) =>
        {
            start.Dispose();
            await Start();
            if (selftest != null) await SelfTest(selftest);
            else if (showStudio || firstRun) OpenStudio();
            if (firstRun && selftest == null)
                tray.ShowBalloonTip(6000, "asciipaper is running", "Your wallpaper lives in the tray, down here. Double-click to open asciipaper.", ToolTipIcon.Info);
        };
        start.Start();
    }

    // ---- Settings
    public string Current => config.Str("wallpaper", "fluid");
    public bool Paused => config.TryGetValue("paused", out var p) && p is true;
    string Options => Json.Compact(new Dictionary<string, object> {
        ["fps"] = config.Num("fps", 24), ["idleFps"] = config.Num("idleFps", 12),
        ["quality"] = config.Num("quality", 1), ["pointer"] = config.Num("pointer", 1), ["speed"] = config.Num("speed", 1),
        ["clicks"] = config.TryGetValue("clicks", out var c) && c is true });   // click effects are opt-in

    static Dictionary<string, object> LoadConfig(out bool firstRun)
    {
        firstRun = !File.Exists(ConfigFile);
        try { return firstRun ? new() : Json.Object(File.ReadAllText(ConfigFile)); }
        catch (Exception) { return new(); }
    }
    void SaveConfig() => File.WriteAllText(ConfigFile, Json.Pretty(config) + "\n");

    public static bool Autostart
    {
        get { using var key = Registry.CurrentUser.OpenSubKey(RunKey); return key?.GetValue("asciipaper") != null; }
        set
        {
            using var key = Registry.CurrentUser.CreateSubKey(RunKey);
            if (value) key.SetValue("asciipaper", $"\"{Application.ExecutablePath}\" --background");
            else key.DeleteValue("asciipaper", false);
        }
    }

    public Dictionary<string, object> State() => new()
    {
        ["current"] = Current, ["paused"] = Paused, ["autostart"] = Autostart, ["version"] = Program.Version,
        ["options"] = Json.Object(Options), ["library"] = Library.List(),
    };

    // ---- Wallpapers
    async Task Start()
    {
        try
        {
            Environment = await CoreWebView2Environment.CreateAsync(null, Library.WebData, new CoreWebView2EnvironmentOptions(
                "--autoplay-policy=no-user-gesture-required --disable-background-timer-throttling --disable-renderer-backgrounding " +
                "--disable-backgrounding-occluded-windows --disable-features=CalculateNativeWinOcclusion"));
        }
        catch (Exception error) { WebView2Missing(error); Quit(); return; }
        if (!Library.Exists(Current)) { config["wallpaper"] = "fluid"; SaveConfig(); }
        await Rebuild();
        hook = Native.SetWindowsHookEx(Native.WH_MOUSE_LL, mouseProc, Native.GetModuleHandle(null), 0);
        coverTimer.Start();
    }

    // One wallpaper per monitor, rebuilt when monitors change.
    async Task Rebuild()
    {
        if (Environment == null) return;
        foreach (var w in wallpapers) w.Dispose();
        wallpapers.Clear();
        pointerOn = null;
        worker = Desktop.WorkerW();
        var url = Library.PageUrl(Current) ?? Library.PageUrl("fluid");
        foreach (var screen in Screen.AllScreens)
        {
            var w = new WallpaperWindow(Environment, screen);
            wallpapers.Add(w);
            await w.Start(worker, url, Options);
        }
        UpdatePause();
    }

    // Explorer restarted: its desktop layer is new.
    void Reattach()
    {
        worker = Desktop.WorkerW();
        foreach (var w in wallpapers) w.Attach(worker);
    }

    public async Task Apply(string name)
    {
        if (!Library.Exists(name)) throw new InvalidOperationException($"There's no wallpaper called {name}");
        config["wallpaper"] = name;
        config["paused"] = false;
        SaveConfig();
        var url = Library.PageUrl(name);
        if (wallpapers.Count == 0) await Rebuild();
        foreach (var w in wallpapers) w.Navigate(url);
        UpdatePause();
        studio?.Send("state", State());
    }

    public async Task Remove(string name)
    {
        Library.Remove(name);
        if (name == Current) await Apply("fluid");
    }

    public void SetPaused(bool paused)
    {
        config["paused"] = paused;
        SaveConfig();
        UpdatePause();
        studio?.Send("state", State());
    }

    public async Task SetOptions(Dictionary<string, object> options)
    {
        foreach (var key in new[] { "fps", "idleFps", "quality", "pointer", "speed" })
            if (options != null && options.ContainsKey(key)) config[key] = options.Num(key, 1);
        if (options != null && options.TryGetValue("clicks", out var clicks)) config["clicks"] = clicks is true;
        SaveConfig();
        foreach (var w in wallpapers) await w.SetOptions(Options);
    }

    public void SpecChanged(string name)
    {
        if (name == Current) foreach (var w in wallpapers) w.SpecChanged();
    }

    bool WatchedFile(string file)
    {
        if (file == null) return false;
        if (string.Equals(file, Current + ".json", StringComparison.OrdinalIgnoreCase)) return true;
        try { return string.Equals(file, Json.Object(File.ReadAllText(Library.SpecPath(Current))).Str("shader"), StringComparison.OrdinalIgnoreCase); }
        catch (Exception) { return false; }
    }

    // Stop drawing where nobody can see it: paused, locked, or under a fullscreen or maximized window.
    void UpdatePause()
    {
        pauseItem.Checked = Paused;
        var covered = Desktop.Covered(Screen.AllScreens);
        foreach (var w in wallpapers) w.Pause(Paused || locked || covered.Contains(w.Screen.DeviceName));
    }

    // ---- The mouse: the icons sit on top of the wallpaper, so it never gets input itself. While the
    // pointer is over the bare desktop, moves and clicks are forwarded (at most ~60 per second).
    IntPtr MouseHook(int code, IntPtr message, IntPtr info)
    {
        int m = message.ToInt32();
        if (code >= 0 && wallpapers.Count > 0 && (m == Native.WM_MOUSEMOVE || m == Native.WM_LBUTTONDOWN || m == Native.WM_LBUTTONUP))
        {
            int now = System.Environment.TickCount;
            if (m != Native.WM_MOUSEMOVE || now - lastMove >= 16)
            {
                lastMove = now;
                var pt = Marshal.PtrToStructure<Native.MSLLHOOKSTRUCT>(info).pt;
                var ours = new HashSet<IntPtr>(wallpapers.Select(w => w.Handle));
                var over = Desktop.IsDesktop(Native.WindowFromPoint(pt), ours)
                    ? wallpapers.FirstOrDefault(w => !w.Paused && w.Screen.Bounds.Contains(pt.X, pt.Y)) : null;
                if (pointerOn != null && pointerOn != over) pointerOn.Pointer('o', 0, 0);
                pointerOn = over;
                if (over != null)
                {
                    var b = over.Screen.Bounds;
                    over.Pointer(m == Native.WM_LBUTTONDOWN ? 'd' : m == Native.WM_LBUTTONUP ? 'u' : 'm',
                                 (pt.X - b.X) / (double)b.Width, (pt.Y - b.Y) / (double)b.Height);
                }
            }
        }
        return Native.CallNextHookEx(hook, code, message, info);
    }

    // ---- Studio, instances, quitting
    public void OpenStudio()
    {
        if (studio == null || studio.IsDisposed)
        {
            studio = new StudioWindow(this);
            studio.FormClosed += (_, _) => studio = null;
            studio.Show();
        }
        else
        {
            if (studio.WindowState == FormWindowState.Minimized) studio.WindowState = FormWindowState.Normal;
            studio.Activate();
        }
    }

    void Listen(string name, Action action)
    {
        var signal = new EventWaitHandle(false, EventResetMode.AutoReset, name);
        new Thread(() => { while (signal.WaitOne()) ui.Post(_ => action(), null); }) { IsBackground = true }.Start();
    }

    public void Quit()
    {
        if (hook != IntPtr.Zero) Native.UnhookWindowsHookEx(hook);
        coverTimer.Stop();
        tray.Visible = false;
        studio?.Close();
        foreach (var w in wallpapers) w.Dispose();
        wallpapers.Clear();
        RefreshDesktop();
        ExitThread();
    }

    // Make Explorer repaint the normal wallpaper where ours was.
    static void RefreshDesktop()
    {
        var path = new StringBuilder(260);
        if (SystemParametersInfo(0x73, path.Capacity, path, 0)) SystemParametersInfo(0x14, 0, path, 0x2);
    }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool SystemParametersInfo(uint action, int param, StringBuilder value, uint flags);

    public static void WebView2Missing(Exception error)
    {
        var answer = MessageBox.Show("asciipaper needs Microsoft Edge WebView2, which comes with Windows 11 and most of Windows 10. " +
                                     "Open the download page now?\n\n" + error.Message, "asciipaper", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
        if (answer == DialogResult.Yes)
            Process.Start(new ProcessStartInfo("https://developer.microsoft.com/microsoft-edge/webview2/") { UseShellExecute = true });
    }

    // Top-level window that hears Explorer restart ("TaskbarCreated" is broadcast to top-level windows).
    sealed class MessageWindow : NativeWindow
    {
        readonly uint taskbarCreated = Native.RegisterWindowMessage("TaskbarCreated");
        readonly Action onExplorerRestart;
        public MessageWindow(Action onExplorerRestart) { this.onExplorerRestart = onExplorerRestart; CreateHandle(new CreateParams()); }
        protected override void WndProc(ref Message m)
        {
            if ((uint)m.Msg == taskbarCreated) onExplorerRestart();
            base.WndProc(ref m);
        }
    }

    // ---- --selftest DIR: what CI runs on a real Windows machine. It exercises the whole app and
    // leaves screenshots and a log: the desktop with the wallpaper, each wallpaper view, the Studio,
    // a picture ported through the Studio, and the Customize panel.
    async Task SelfTest(string dir)
    {
        Directory.CreateDirectory(dir);
        var log = new StringBuilder();
        void Note(string line) { log.AppendLine(line); File.WriteAllText(Path.Combine(dir, "log.txt"), log.ToString()); }
        try
        {
            Note($"asciipaper {Program.Version}; {System.Environment.OSVersion}; WebView2 {Environment?.BrowserVersionString}");
            Note(Desktop.Log);
            foreach (var s in Screen.AllScreens) Note($"screen {s.DeviceName} {s.Bounds} primary={s.Primary}");
            Note($"wallpaper views: {wallpapers.Count}; current: {Current}");
            await Task.Delay(8000);
            await Shots("1-preset");

            OpenStudio();
            await Task.Delay(9000);
            await studio.Screenshot(Path.Combine(dir, "2-studio.png"));

            var picture = Path.Combine(Path.GetTempPath(), "asciipaper-selftest.png");
            using (var bmp = new Bitmap(800, 600))
            using (var g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                using (var sky = new LinearGradientBrush(new Rectangle(0, 0, 800, 600), Color.FromArgb(20, 30, 90), Color.FromArgb(250, 150, 60), 90f))
                    g.FillRectangle(sky, 0, 0, 800, 600);
                g.FillEllipse(Brushes.Gold, 300, 120, 200, 200);
                g.FillPolygon(Brushes.Black, new[] { new Point(0, 600), new Point(250, 330), new Point(430, 470), new Point(600, 300), new Point(800, 600) });
                bmp.Save(picture);
            }
            var imported = Library.Import(picture, "selftest sunset");
            Note($"imported: {Json.Compact(imported)}");
            await studio.Run($"port({Json.Compact(imported)})");
            await Task.Delay(9000);
            Note($"spec written: {File.Exists(Library.SpecPath((string)imported["name"]))}; current: {Current}");
            await studio.Screenshot(Path.Combine(dir, "3-studio-ported.png"));
            await Shots("3-ported");

            await studio.Run("openDrawer(state.current)");
            await Task.Delay(5000);
            await studio.Screenshot(Path.Combine(dir, "4-customize.png"));
            await studio.Run("document.querySelector('#controls select').value = document.querySelector('#controls select').options[2].value; document.querySelector('#controls select').dispatchEvent(new Event('change'))");
            await Task.Delay(4000);
            await Shots("4-customized");

            await Apply("tunnel");   // a built-in shader wallpaper (wallpapers/specs)
            await Task.Delay(6000);
            Note($"built-in: current={Current}");
            await Shots("5-builtin");
            Note("done");
        }
        catch (Exception error) { Note("FAILED: " + error); }
        Quit();

        async Task Shots(string label)
        {
            for (int i = 0; i < wallpapers.Count; i++) await wallpapers[i].Screenshot(Path.Combine(dir, $"{label}-view{i}.png"));
            var area = SystemInformation.VirtualScreen;
            using var shot = new Bitmap(area.Width, area.Height);
            using (var g = Graphics.FromImage(shot)) g.CopyFromScreen(area.Location, Point.Empty, area.Size);
            shot.Save(Path.Combine(dir, $"{label}-desktop.png"));
        }
    }
}
