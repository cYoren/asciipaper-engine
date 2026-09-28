using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Asciipaper;

// The Studio window: studio/index.html in WebView2. The page calls the app with
// {id, method, params} messages (see `host` in studio.js); each gets {id, result} or {id, error}.
sealed class StudioWindow : Form
{
    readonly App app;
    public readonly WebView2 View = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(13, 15, 15) };

    public StudioWindow(App app)
    {
        this.app = app;
        Text = "asciipaper";
        Icon = App.AppIcon;
        BackColor = Color.FromArgb(13, 15, 15);
        StartPosition = FormStartPosition.CenterScreen;
        var area = Screen.PrimaryScreen.WorkingArea;
        Size = new Size(Math.Min(1180, area.Width - 80), Math.Min(900, area.Height - 60));
        MinimumSize = new Size(760, 560);
        Controls.Add(View);
    }

    protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); Native.DarkTitleBar(Handle); }

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        try
        {
            await View.EnsureCoreWebView2Async(app.Environment);
            var core = View.CoreWebView2;
            core.SetVirtualHostNameToFolderMapping(Library.Host, Library.Root, CoreWebView2HostResourceAccessKind.Allow);
            core.Settings.AreDevToolsEnabled = Program.Debug;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.WebMessageReceived += OnMessage;
            // Links out of the app open in the browser; the Studio itself never navigates away.
            core.NavigationStarting += (_, a) =>
            {
                if (a.Uri.StartsWith(Library.Origin + "/", StringComparison.OrdinalIgnoreCase)) return;
                a.Cancel = true;
                if (a.Uri.StartsWith("https://") || a.Uri.StartsWith("http://")) Process.Start(new ProcessStartInfo(a.Uri) { UseShellExecute = true });
            };
            core.NewWindowRequested += (_, a) => { a.Handled = true; Process.Start(new ProcessStartInfo(a.Uri) { UseShellExecute = true }); };
            core.Navigate(Library.Origin + "/app/studio/index.html");
        }
        catch (Exception error) { App.WebView2Missing(error); Close(); }
    }

    public void Send(string eventName, object data)
    {
        if (View.CoreWebView2 != null) View.CoreWebView2.PostWebMessageAsJson(Json.Compact(new Dictionary<string, object> { ["event"] = eventName, ["data"] = data }));
    }

    async void OnMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        object id = null;
        try
        {
            var message = Json.Object(e.WebMessageAsJson);
            id = message.TryGetValue("id", out var i) ? i : null;
            var p = message.TryGetValue("params", out var q) ? q as Dictionary<string, object> ?? new() : new();
            var files = e.AdditionalObjects?.OfType<CoreWebView2File>().Select(f => f.Path).ToList() ?? new List<string>();
            var result = await Call(message.Str("method"), p, files);
            Reply(new Dictionary<string, object> { ["id"] = id, ["result"] = result });
        }
        catch (Exception error)
        {
            Reply(new Dictionary<string, object> { ["id"] = id, ["error"] = (error as AggregateException)?.InnerException?.Message ?? error.Message });
        }
    }

    void Reply(object message)
    {
        if (!IsDisposed && View.CoreWebView2 != null) View.CoreWebView2.PostWebMessageAsJson(Json.Compact(message));
    }

    async Task<object> Call(string method, Dictionary<string, object> p, List<string> files)
    {
        switch (method)
        {
            case "state": return app.State();
            case "apply": await app.Apply(p.Str("name")); return app.State();
            case "pause": app.SetPaused(p.TryGetValue("paused", out var paused) && paused is true); return app.State();
            case "setOptions": await app.SetOptions(p["options"] as Dictionary<string, object>); return app.State();
            case "setAutostart": App.Autostart = p.TryGetValue("on", out var on) && on is true; return app.State();
            case "saveSpec":
                Library.SaveSpec(p.Str("name"), p["spec"]);
                app.SpecChanged(p.Str("name"));
                return true;
            case "saveThumb": return Library.SaveThumb(p.Str("name"), p.Str("data"));
            case "remove": await app.Remove(p.Str("name")); return app.State();
            case "newShader":
                Library.NewShader(p.Str("name"));
                await app.Apply(p.Str("name"));
                return app.State();
            case "openFolder": Library.OpenFolder(); return true;
            case "importUrl": return await Library.ImportUrl(p.Str("url"));
            case "importDropped":
                if (files.Count == 0) throw new InvalidOperationException("Drop a file from your computer");
                return Library.Import(files[0]);
            case "pickMedia":
                using (var dialog = new OpenFileDialog
                {
                    Title = "Choose a picture, GIF or video",
                    Filter = "Pictures, GIFs and videos|*.gif;*.png;*.jpg;*.jpeg;*.webp;*.bmp;*.avif;*.mp4;*.webm;*.mov;*.m4v;*.mkv|All files|*.*",
                })
                    return dialog.ShowDialog(this) == DialogResult.OK ? Library.Import(dialog.FileName) : null;
            default: throw new InvalidOperationException($"unknown request: {method}");
        }
    }

    public Task<bool> Screenshot(string file) => WallpaperWindow.CaptureView(View, file);
    public Task<string> Run(string script) => View.CoreWebView2.ExecuteScriptAsync(script);
}
