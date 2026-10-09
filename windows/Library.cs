using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace Asciipaper;

// Where everything lives, and the user's wallpapers. All of it is served to WebView2 from one
// origin, https://asciipaper.example/, mapped to Root:
//   app\       the Studio and built-in wallpapers (copied from the install folder)
//   library\   the user's wallpapers: NAME.json specs, shaders, media\, and HTML wallpapers
//   thumbs\    thumbnails of the user's wallpapers
static class Library
{
    public const string Host = "asciipaper.example", Origin = "https://" + Host;
    public static readonly string Root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "asciipaper");
    public static readonly string App = Path.Combine(Root, "app"), Folder = Path.Combine(Root, "library"),
        Media = Path.Combine(Folder, "media"), Thumbs = Path.Combine(Root, "thumbs"), WebData = Path.Combine(Root, "webview");
    public static readonly string[] Presets = { "fluid", "flow", "matrix", "yin-yang" };
    static readonly Regex NameRe = new(@"^[A-Za-z0-9][A-Za-z0-9 _-]{0,47}$");
    static readonly HashSet<string> Pictures = new(StringComparer.OrdinalIgnoreCase) { ".gif", ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".avif", ".apng" };
    static readonly HashSet<string> Videos = new(StringComparer.OrdinalIgnoreCase) { ".mp4", ".webm", ".mov", ".m4v", ".mkv", ".ogv" };

    // Copy the Studio and built-in wallpapers from the install folder when this build is new.
    public static void Sync()
    {
        string source = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "web"), stamp = Path.Combine(App, ".build");
        string build = File.GetLastWriteTimeUtc(typeof(Library).Assembly.Location).Ticks + " " + Program.Version;
        Directory.CreateDirectory(Folder); Directory.CreateDirectory(Media); Directory.CreateDirectory(Thumbs);
        if (File.Exists(stamp) && File.ReadAllText(stamp) == build) return;
        if (Directory.Exists(App)) Directory.Delete(App, true);
        foreach (var file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
        {
            var target = Path.Combine(App, file.Substring(source.Length + 1));
            Directory.CreateDirectory(Path.GetDirectoryName(target));
            File.Copy(file, target, true);
        }
        // HTML wallpapers in the library load ./lib/asciipaper.js: keep them on the current runtime.
        Directory.CreateDirectory(Path.Combine(Folder, "lib"));
        File.Copy(Path.Combine(App, @"wallpapers\lib\asciipaper.js"), Path.Combine(Folder, @"lib\asciipaper.js"), true);
        File.WriteAllText(stamp, build);
    }

    // One ZIP that runs anywhere, like `asciipaper export` on Linux: index.html (made by the Studio), the
    // runtime, the media it plays, and the files Wallpaper Engine (project.json) and Lively read. Plash on
    // macOS opens index.html.
    public static string ExportZip(string file, string title, string html, string media)
    {
        if (string.IsNullOrEmpty(html)) throw new InvalidOperationException("Nothing to export");
        if (File.Exists(file)) File.Delete(file);
        using var zip = ZipFile.Open(file, ZipArchiveMode.Create);
        void Text(string entry, string text)
        {
            using var writer = new StreamWriter(zip.CreateEntry(entry).Open(), new UTF8Encoding(false));
            writer.Write(text);
        }
        Text("index.html", html);
        foreach (var lib in Directory.GetFiles(Path.Combine(App, @"wallpapers\lib")))
            zip.CreateEntryFromFile(lib, "lib/" + Path.GetFileName(lib));
        if (!string.IsNullOrEmpty(media))
        {
            var source = Path.GetFullPath(Path.Combine(Folder, media.Replace('/', '\\')));
            if (!source.StartsWith(Folder + "\\", StringComparison.OrdinalIgnoreCase) || !File.Exists(source))
                throw new InvalidOperationException("This wallpaper's picture or video is missing");
            zip.CreateEntryFromFile(source, media.Replace('\\', '/'));
        }
        Text("LivelyInfo.json", Json.Pretty(new Dictionary<string, object> {
            ["AppVersion"] = "2.0.7.0", ["Title"] = title, ["Desc"] = "Interactive ASCII wallpaper made with asciipaper.",
            ["Contact"] = "https://github.com/cYoren/asciipaper", ["Type"] = 1, ["FileName"] = "index.html", ["IsAbsolutePath"] = false }));
        Text("project.json", Json.Pretty(new Dictionary<string, object> {
            ["file"] = "index.html", ["title"] = title, ["type"] = "web",
            ["description"] = "Interactive ASCII wallpaper made with asciipaper (https://github.com/cYoren/asciipaper)." }));
        Text("README.txt", $"{title}: an interactive ASCII wallpaper made with asciipaper.\r\n\r\n" +
            "Windows, Wallpaper Engine: Create Wallpaper > Open wallpaper > choose project.json.\r\n" +
            "Windows, Lively Wallpaper: drag this ZIP onto Lively.\r\n" +
            "macOS, Plash: unzip, then Add Website > the index.html file.\r\n" +
            "Linux: get asciipaper (https://github.com/cYoren/asciipaper) and run: asciipaper index.html\r\n");
        return file;
    }

    public static bool Valid(string name) => name != null && NameRe.IsMatch(name);
    public static string ImportProject(Dictionary<string, object> project)
    {
        if (project == null || project.Str("format") != "asciipaper.project" || project.Num("version", 0) != 1)
            throw new InvalidOperationException("Unsupported project version");
        if (!project.TryGetValue("spec", out var raw) || raw is not Dictionary<string, object> spec ||
            !Regex.IsMatch(spec.Str("shader", ""), @"\bcell\s*\(") || spec.Str("shader", "").Length > 262144) throw new InvalidOperationException("Missing embedded shader");
        var name = NewName(project.Str("title", "wallpaper"));
        string mediaFile = null;
        if (project.TryGetValue("media", out var m) && m is Dictionary<string, object> media)
        {
            var file = media.Str("name", "");
            if (!Regex.IsMatch(file, @"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$") || file.Contains("..")) throw new InvalidOperationException("Invalid media name");
            var data = media.Str("data", "");
            if (data.Length > 89478488) throw new InvalidOperationException("Maximum media size is 64 MiB");
            var bytes = Convert.FromBase64String(data);
            if (bytes.Length > 64 * 1024 * 1024) throw new InvalidOperationException("Maximum media size is 64 MiB");
            mediaFile = Path.Combine(Media, name + "-" + file);
            File.WriteAllBytes(mediaFile, bytes);
            spec["media"] = "media/" + Path.GetFileName(mediaFile);
        }
        else if (spec.ContainsKey("media")) throw new InvalidOperationException("Missing media");
        spec.Remove("frames");
        try { SaveSpec(name, spec); }
        catch { if (mediaFile != null) File.Delete(mediaFile); throw; }
        return name;
    }
    public static string SpecPath(string name) => Path.Combine(Folder, name + ".json");
    static string Url(string relative) => "/" + string.Join("/", relative.Split('/').Select(Uri.EscapeDataString));

    // Built-in shader wallpapers: app\wallpapers\specs\NAME.json (+ its .glsl). Adding one is just adding the files.
    static string BuiltinSpecs => Path.Combine(App, @"wallpapers\specs");
    static bool IsBuiltinSpec(string name) => Valid(name) && File.Exists(Path.Combine(BuiltinSpecs, name + ".json"));

    public static bool Exists(string name) => Presets.Contains(name) || IsBuiltinSpec(name) ||
        (Valid(name) && (File.Exists(SpecPath(name)) || File.Exists(Path.Combine(Folder, name + ".html"))));

    // Every wallpaper, as the Studio shows it. `url` runs it; `spec` is its JSON, if it has one.
    public static List<Dictionary<string, object>> List()
    {
        var list = Presets.Where(n => !IsBuiltinSpec(n)).Select(n => new Dictionary<string, object> {
            ["name"] = n, ["title"] = n, ["kind"] = "preset", ["own"] = false,
            ["url"] = Url($"app/wallpapers/{n}.html"),
            ["thumb"] = File.Exists(Path.Combine(App, $@"wallpapers\thumbnails\{n}.jpg")) ? Url($"app/wallpapers/thumbnails/{n}.jpg") : null }).ToList();
        if (Directory.Exists(BuiltinSpecs))
            foreach (var name in Directory.GetFiles(BuiltinSpecs, "*.json").Select(Path.GetFileNameWithoutExtension).Where(Valid).OrderBy(n => n, StringComparer.OrdinalIgnoreCase))
            {
                string title = name;
                try { title = Json.Object(File.ReadAllText(Path.Combine(BuiltinSpecs, name + ".json"))).Str("title", name); } catch (Exception) { }
                list.Add(new() { ["name"] = name, ["title"] = title, ["kind"] = "spec", ["own"] = false,
                    ["url"] = Url("app/wallpapers/run.html") + "?spec=" + Uri.EscapeDataString(Url($"app/wallpapers/specs/{name}.json")),
                    ["spec"] = Url($"app/wallpapers/specs/{name}.json"),
                    ["thumb"] = File.Exists(Path.Combine(App, $@"wallpapers\thumbnails\{name}.jpg")) ? Url($"app/wallpapers/thumbnails/{name}.jpg") : null });
            }
        var specs = Directory.GetFiles(Folder, "*.json").Select(Path.GetFileNameWithoutExtension).Where(Valid).OrderBy(n => n, StringComparer.OrdinalIgnoreCase);
        foreach (var name in specs)
        {
            string title = name;
            try { title = Json.Object(File.ReadAllText(SpecPath(name))).Str("title", name); } catch (Exception) { }
            list.Add(new() { ["name"] = name, ["title"] = title, ["kind"] = "spec", ["own"] = true,
                ["url"] = Url("app/wallpapers/run.html") + "?spec=" + Uri.EscapeDataString(Url($"library/{name}.json")),
                ["spec"] = Url($"library/{name}.json"), ["thumb"] = Thumb(name) });
        }
        foreach (var name in Directory.GetFiles(Folder, "*.html").Select(Path.GetFileNameWithoutExtension)
                     .Where(n => Valid(n) && !File.Exists(SpecPath(n))).OrderBy(n => n, StringComparer.OrdinalIgnoreCase))
            list.Add(new() { ["name"] = name, ["title"] = name, ["kind"] = "html", ["own"] = true,
                ["url"] = Url($"library/{name}.html"), ["thumb"] = Thumb(name) });
        return list;
    }

    public static string PageUrl(string name) => List().FirstOrDefault(w => (string)w["name"] == name)?["url"] as string;

    static string Thumb(string name)
    {
        var file = Path.Combine(Thumbs, name + ".jpg");
        return File.Exists(file) ? Url($"thumbs/{name}.jpg") + "?v=" + File.GetLastWriteTimeUtc(file).Ticks : null;
    }

    public static string SaveThumb(string name, string dataUrl)
    {
        if (!Valid(name) && !Presets.Contains(name)) throw new ArgumentException("bad name");
        var comma = dataUrl.IndexOf(',');
        File.WriteAllBytes(Path.Combine(Thumbs, name + ".jpg"), Convert.FromBase64String(dataUrl.Substring(comma + 1)));
        return Thumb(name);
    }

    public static void SaveSpec(string name, object spec)
    {
        if (!Valid(name)) throw new ArgumentException("Names use letters, numbers, spaces, _ and -");
        File.WriteAllText(SpecPath(name), Json.Pretty(spec) + "\n", new UTF8Encoding(false));
        File.Delete(Path.Combine(Thumbs, name + ".jpg"));   // stale now; the Studio makes a new one
    }

    // A name for a new wallpaper, from a title or file name: plain letters, unique.
    public static string NewName(string from)
    {
        var stem = Regex.Replace((from ?? "").Normalize(NormalizationForm.FormKC), @"[^A-Za-z0-9 _-]+", "").Trim();
        stem = Regex.Replace(Regex.Replace(stem, @"\s*-\s*", "-"), @"\s+", "-").ToLowerInvariant();
        if (stem.Length > 40) stem = stem.Substring(0, 40).TrimEnd('-');
        if (stem.Length == 0 || !char.IsLetterOrDigit(stem[0])) stem = "ported";
        string name = stem;
        for (int i = 2; Exists(name); i++) name = $"{stem}-{i}";
        return name;
    }

    // Copy a picture, GIF or video into the library. The Studio then measures it and writes the spec.
    public static Dictionary<string, object> Import(string file, string title = null)
    {
        var ext = Path.GetExtension(file);
        if (!Pictures.Contains(ext) && !Videos.Contains(ext))
            throw new InvalidOperationException("That isn't a picture, GIF or video asciipaper can use");
        var name = NewName(title ?? Path.GetFileNameWithoutExtension(file));
        var stored = name + ext.ToLowerInvariant();
        File.Copy(file, Path.Combine(Media, stored), true);
        return new() { ["name"] = name, ["title"] = title ?? name, ["relative"] = "media/" + stored,
                       ["media"] = Url("library/media/" + stored) };
    }

    static readonly HttpClient http = CreateClient();
    static HttpClient CreateClient()
    {
        ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
        var client = new HttpClient { Timeout = TimeSpan.FromMinutes(2) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("asciipaper (https://github.com/cYoren/asciipaper)");
        return client;
    }

    // Download a media link; posts on X/Twitter go through the public fxtwitter API.
    public static async Task<Dictionary<string, object>> ImportUrl(string url)
    {
        string title = null;
        var post = Regex.Match(url, @"^https?://(?:www\.)?(?:x|twitter|fxtwitter|vxtwitter)\.com/(\w+)/status/(\d+)");
        if (post.Success)
        {
            var api = Json.Object(await http.GetStringAsync($"https://api.fxtwitter.com/{post.Groups[1].Value}/status/{post.Groups[2].Value}"));
            var tweet = api.TryGetValue("tweet", out var t) ? t as Dictionary<string, object> : null;
            var all = (tweet?.TryGetValue("media", out var m) == true ? m as Dictionary<string, object> : null)?.TryGetValue("all", out var a) == true ? a as object[] : null;
            if (all == null || all.Length == 0) throw new InvalidOperationException("That post has no picture, GIF or video");
            url = ((Dictionary<string, object>)all[0]).Str("url");
            var text = Regex.Replace(tweet.Str("text", ""), @"https?://\S+", "").Normalize(NormalizationForm.FormKC);
            text = Regex.Replace(text, @"\s+", " ").Trim();
            var author = (tweet.TryGetValue("author", out var au) ? au as Dictionary<string, object> : null).Str("name", post.Groups[1].Value);
            title = text.Length > 0 && text.Length <= 40 ? text : author.Normalize(NormalizationForm.FormKC);
        }
        var ext = Path.GetExtension(new Uri(url).AbsolutePath);
        if (!Pictures.Contains(ext) && !Videos.Contains(ext)) ext = ".mp4";
        var temp = Path.Combine(Path.GetTempPath(), "asciipaper-" + Guid.NewGuid().ToString("N") + ext);
        try
        {
            using (var response = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead))
            {
                response.EnsureSuccessStatusCode();
                var type = response.Content.Headers.ContentType?.MediaType ?? "";
                if (type.StartsWith("image/gif")) temp = Path.ChangeExtension(temp, ".gif");
                else if (type.StartsWith("image/png")) temp = Path.ChangeExtension(temp, ".png");
                else if (type.StartsWith("image/jpeg")) temp = Path.ChangeExtension(temp, ".jpg");
                else if (type.StartsWith("image/webp")) temp = Path.ChangeExtension(temp, ".webp");
                using var output = File.Create(temp);
                await (await response.Content.ReadAsStreamAsync()).CopyToAsync(output);
            }
            return Import(temp, title ?? Path.GetFileNameWithoutExtension(new Uri(url).AbsolutePath));
        }
        finally { try { File.Delete(temp); } catch (IOException) { } }
    }

    // The user's own copy of a built-in shader wallpaper, to customize; returns its name.
    public static string CopyBuiltin(string name)
    {
        if (!IsBuiltinSpec(name)) throw new InvalidOperationException("Only built-in shader wallpapers can be copied");
        var spec = Json.Object(File.ReadAllText(Path.Combine(BuiltinSpecs, name + ".json")));
        var copy = NewName(name + "-mine");
        var shader = spec.Str("shader");
        if (shader != null && shader.EndsWith(".glsl") && !shader.Contains("/"))
        {
            File.Copy(Path.Combine(BuiltinSpecs, shader), Path.Combine(Folder, copy + ".glsl"), true);
            spec["shader"] = copy + ".glsl";
        }
        spec["title"] = spec.Str("title", name) + " (mine)";
        SaveSpec(copy, spec);
        return copy;
    }

    public static void Remove(string name)
    {
        if (!Valid(name) || Presets.Contains(name)) throw new InvalidOperationException("Built-in wallpapers can't be deleted");
        var spec = SpecPath(name);
        if (File.Exists(spec))
        {
            var data = Json.Object(File.ReadAllText(spec));
            foreach (var key in new[] { "media", "shader" })
            {
                var relative = data.Str(key);
                if (relative == null || relative == "media" || Regex.IsMatch(relative, @"\bcell\s*\(")) continue;
                var path = Path.GetFullPath(Path.Combine(Folder, relative));
                if (path.StartsWith(Folder + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) File.Delete(path);
            }
            File.Delete(spec);
        }
        File.Delete(Path.Combine(Folder, name + ".html"));
        File.Delete(Path.Combine(Thumbs, name + ".jpg"));
    }

    public static void NewShader(string name)
    {
        if (!Valid(name) || Exists(name)) throw new InvalidOperationException("Choose a new name: letters, numbers, spaces, _ and -");
        File.Copy(Path.Combine(App, @"wallpapers\starter.glsl"), Path.Combine(Folder, name + ".glsl"));
        SaveSpec(name, new Dictionary<string, object> {
            ["title"] = name, ["shader"] = name + ".glsl", ["charset"] = " .:-=+ASCIIFY#@", ["cell"] = 10,
            ["aspect"] = 0.6, ["background"] = "#080909", ["fill"] = 0.1,
            ["uniforms"] = new Dictionary<string, object> { ["speed"] = 1 } });
        OpenInEditor(Path.Combine(Folder, name + ".glsl"));
    }

    public static void OpenInEditor(string file)
    {
        try { Process.Start(new ProcessStartInfo(file) { UseShellExecute = true, Verb = "edit" }); }
        catch (Exception) { Process.Start("notepad.exe", "\"" + file + "\""); }   // .glsl has no editor registered
    }

    public static void OpenFolder() => Process.Start(new ProcessStartInfo(Folder) { UseShellExecute = true });
}
