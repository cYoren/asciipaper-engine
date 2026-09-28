using System;
using System.Drawing;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Asciipaper;

// One monitor's wallpaper: a borderless window inside the desktop layer, showing the wallpaper page.
sealed class WallpaperWindow : Form
{
    // Runs in every wallpaper page before its own scripts: the user's settings, and a listener for
    // what the app sends. The mouse arrives as "p KIND X Y" (0..1), because the icons sit on top of
    // the wallpaper and it never gets real input; it's replayed as pointer and mouse events.
    const string Bridge = @"
window.__asciipaperOptions = OPTIONS;
window.chrome.webview.addEventListener('message', e => {
  const m = String(e.data).split(' ');
  if (m[0] === 'p') {
    const x = +m[2] * innerWidth, y = +m[3] * innerHeight, kind = m[1];
    const target = document.elementFromPoint(x, y) || document.documentElement;
    const init = {clientX: x, clientY: y, screenX: x, screenY: y, bubbles: true, cancelable: true, composed: true,
                  pointerId: 1, pointerType: 'mouse', isPrimary: true, button: kind === 'm' ? -1 : 0,
                  buttons: kind === 'd' ? 1 : 0, relatedTarget: null};
    const types = {m: ['pointermove', 'mousemove'], d: ['pointerdown', 'mousedown'], u: ['pointerup', 'mouseup', 'click'],
                   o: ['pointerout', 'mouseout']}[kind] || [];
    for (const t of types) target.dispatchEvent(t.startsWith('pointer') ? new PointerEvent(t, init) : new MouseEvent(t, init));
    if (kind === 'o') { dispatchEvent(new PointerEvent('pointerleave', init)); document.dispatchEvent(new MouseEvent('mouseleave', init)); }
  } else if (m[0] === 'set') {
    window.asciipaper?.set(JSON.parse(m.slice(1).join(' ')));
  } else if (m[0] === 'spec') {
    const spec = new URLSearchParams(location.search).get('spec');
    if (spec && window.asciipaper?.patch) asciipaper.patch(spec).then(ok => ok || location.reload(), () => location.reload());
    else location.reload();
  }
});";

    readonly WebView2 view = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.Black };
    readonly CoreWebView2Environment environment;
    string script;
    public Screen Screen;
    public string Url;
    public bool Paused { get; private set; }

    public WallpaperWindow(CoreWebView2Environment environment, Screen screen)
    {
        this.environment = environment;
        Screen = screen;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        BackColor = Color.Black;
        Bounds = screen.Bounds;
        Controls.Add(view);
    }

    protected override CreateParams CreateParams
    {
        get { var p = base.CreateParams; p.ExStyle |= Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE; return p; }
    }
    protected override bool ShowWithoutActivation => true;

    public async Task Start(IntPtr worker, string url, string optionsJson)
    {
        Attach(worker);
        Show();   // after attaching, so it never appears as a normal window
        await view.EnsureCoreWebView2Async(environment);
        var core = view.CoreWebView2;
        core.SetVirtualHostNameToFolderMapping(Library.Host, Library.Root, CoreWebView2HostResourceAccessKind.Allow);
        var settings = core.Settings;
        settings.AreDefaultContextMenusEnabled = false;
        settings.AreDevToolsEnabled = false;
        settings.IsStatusBarEnabled = false;
        settings.IsZoomControlEnabled = false;
        settings.AreBrowserAcceleratorKeysEnabled = false;
        settings.IsSwipeNavigationEnabled = false;
        core.NewWindowRequested += (_, e) => e.Handled = true;   // wallpapers never open windows
        await SetOptions(optionsJson, false);
        Navigate(url);
    }

    // Into the desktop layer, covering this monitor. The layer spans the virtual screen, so this
    // monitor's position is relative to the virtual screen's corner.
    public void Attach(IntPtr worker)
    {
        var style = Native.GetWindowLong(Handle, Native.GWL_STYLE);
        Native.SetWindowLong(Handle, Native.GWL_STYLE, (style & ~Native.WS_POPUP) | Native.WS_CHILD);
        Native.SetParent(Handle, worker);
        var origin = SystemInformation.VirtualScreen.Location;
        var b = Screen.Bounds;
        Native.SetWindowPos(Handle, IntPtr.Zero, b.X - origin.X, b.Y - origin.Y, b.Width, b.Height,
                            Native.SWP_NOZORDER | Native.SWP_NOACTIVATE | Native.SWP_SHOWWINDOW | Native.SWP_FRAMECHANGED);
    }

    public void Navigate(string url)
    {
        Url = url;
        view.CoreWebView2?.Navigate(Library.Origin + url);
    }

    public async Task SetOptions(string optionsJson, bool live = true)
    {
        var core = view.CoreWebView2;
        if (core == null) return;
        if (script != null) core.RemoveScriptToExecuteOnDocumentCreated(script);
        script = await core.AddScriptToExecuteOnDocumentCreatedAsync(Bridge.Replace("OPTIONS", optionsJson));
        if (live) core.PostWebMessageAsString("set " + optionsJson);
    }

    public void SpecChanged() => view.CoreWebView2?.PostWebMessageAsString("spec");

    public void Pointer(char kind, double x, double y) =>
        view.CoreWebView2?.PostWebMessageAsString(FormattableString.Invariant($"p {kind} {x:0.####} {y:0.####}"));

    // Paused views stop drawing entirely: hidden WebView2 content isn't rendered.
    public void Pause(bool paused)
    {
        if (paused == Paused) return;
        Paused = paused;
        view.CoreWebView2?.PostWebMessageAsString("set {\"paused\":" + (paused ? "true" : "false") + "}");
        view.Visible = !paused;
    }

    public Task<bool> Screenshot(string file) => CaptureView(view, file);

    public static async Task<bool> CaptureView(WebView2 view, string file)
    {
        if (view.CoreWebView2 == null) return false;
        using var stream = System.IO.File.Create(file);
        await view.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
        return true;
    }
}
