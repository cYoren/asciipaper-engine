using System;
using System.Linq;
using System.Threading;
using System.Windows.Forms;

namespace Asciipaper;

// asciipaper.exe                 run, and open the Studio
// asciipaper.exe --background    run without opening the Studio (how it starts with Windows)
// asciipaper.exe --quit          close the running asciipaper (the uninstaller uses this)
// asciipaper.exe --selftest DIR  run, exercise everything, leave screenshots and a log in DIR, quit
static class Program
{
    public static readonly string Version = typeof(Program).Assembly.GetName().Version.ToString(3);
    public static bool Debug;

    [STAThread]
    static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Debug = args.Contains("--debug");
        int at = Array.IndexOf(args, "--selftest");
        string selftest = at >= 0 && at + 1 < args.Length ? args[at + 1] : null;
        bool quit = args.Contains("--quit");

        using var instance = new Mutex(true, @"Local\asciipaper-instance", out bool first);
        if (!first)
        {
            // Already running: ask it to open the Studio (or to quit) and leave.
            if (EventWaitHandle.TryOpenExisting(quit ? @"Local\asciipaper-quit" : @"Local\asciipaper-show", out var signal)) signal.Set();
            return;
        }
        if (quit) return;
        Library.Sync();
        Application.Run(new App(showStudio: !args.Contains("--background"), selftest));
    }
}
