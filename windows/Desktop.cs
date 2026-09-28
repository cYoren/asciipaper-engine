using System;
using System.Collections.Generic;
using System.Drawing;
using System.Windows.Forms;

namespace Asciipaper;

// The layer behind the desktop icons, where wallpapers live. Explorer draws the wallpaper image in
// a "WorkerW" window that it creates when Progman receives 0x052C; windows parented to it show
// behind the icons on every monitor. Windows 11 24H2 made that WorkerW a child of Progman.
static class Desktop
{
    public static string Log = "";

    public static IntPtr WorkerW()
    {
        var progman = Native.FindWindow("Progman", null);
        Native.SendMessageTimeout(progman, 0x052C, new IntPtr(0xD), new IntPtr(0x1), Native.SMTO_NORMAL, 1000, out _);
        Native.SendMessageTimeout(progman, 0x052C, IntPtr.Zero, IntPtr.Zero, Native.SMTO_NORMAL, 1000, out _);
        var worker = IntPtr.Zero;
        Native.EnumWindows((top, _) =>
        {
            if (Native.FindWindowEx(top, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero)
                worker = Native.FindWindowEx(IntPtr.Zero, top, "WorkerW", null);   // the WorkerW after the icons' host
            return true;
        }, IntPtr.Zero);
        string how = "WorkerW sibling of the icons (Windows 10, 11 before 24H2)";
        if (worker == IntPtr.Zero)
        {
            worker = Native.FindWindowEx(progman, IntPtr.Zero, "WorkerW", null);   // 24H2 and later
            how = "WorkerW child of Progman (Windows 11 24H2+)";
        }
        if (worker == IntPtr.Zero) { worker = progman; how = "Progman (no WorkerW found)"; }
        Log = $"desktop layer: {how}, progman={progman}, worker={worker}";
        return worker;
    }

    // Is the cursor over the bare desktop (the icons' list view, or the layer behind it)?
    public static bool IsDesktop(IntPtr hwnd, HashSet<IntPtr> ours)
    {
        for (int depth = 0; hwnd != IntPtr.Zero && depth < 4; depth++, hwnd = Native.GetParent(hwnd))
        {
            if (ours.Contains(hwnd)) return true;
            switch (Native.ClassOf(hwnd))
            {
                case "SysListView32": case "SHELLDLL_DefView": case "WorkerW": case "Progman": return true;
                case "Shell_TrayWnd": case "Shell_SecondaryTrayWnd": return false;
            }
        }
        return false;
    }

    // Which monitors are covered: a fullscreen or maximized window in front, or a game or presentation.
    public static HashSet<string> Covered(Screen[] screens)
    {
        var covered = new HashSet<string>();
        if (Native.SHQueryUserNotificationState(out int state) == 0 &&
            (state == Native.QUNS_RUNNING_D3D_FULL_SCREEN || state == Native.QUNS_PRESENTATION_MODE))
        {
            foreach (var s in screens) covered.Add(s.DeviceName);
            return covered;
        }
        var fg = Native.GetForegroundWindow();
        string cls = Native.ClassOf(fg);
        if (fg == IntPtr.Zero || cls is "Progman" or "WorkerW" or "Shell_TrayWnd" or "Shell_SecondaryTrayWnd" ||
            !Native.IsWindowVisible(fg) || !Native.GetWindowRect(fg, out var r)) return covered;
        var rect = Rectangle.FromLTRB(r.Left, r.Top, r.Right, r.Bottom);
        var screen = Screen.FromHandle(fg);
        if (Native.IsZoomed(fg) || rect.Contains(screen.Bounds)) covered.Add(screen.DeviceName);
        return covered;
    }
}
