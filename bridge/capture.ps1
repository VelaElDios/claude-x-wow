# Claude x WoW - captura la esquina superior izquierda de la ventana de WoW.
# Protocolo por stdin/stdout, una línea por petición:
#   entrada: "cap <ancho> <alto>"
#   salida : "OK <ancho> <alto> <base64 BGRA>" | "NOWOW" | "MIN" | "ERR <mensaje>"
$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class CxwCapture {
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int L; public int T; public int R; public int B; }
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);

  static IntPtr hwnd = IntPtr.Zero;
  static DateTime lastLookup = DateTime.MinValue;

  public static void Init() {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { try { SetProcessDPIAware(); } catch { } }
  }

  static IntPtr FindWow() {
    if (hwnd != IntPtr.Zero && (DateTime.Now - lastLookup).TotalSeconds < 5) return hwnd;
    lastLookup = DateTime.Now;
    hwnd = IntPtr.Zero;
    foreach (string name in new string[] { "Wow", "WowClassic", "WowT", "WowB" }) {
      foreach (Process p in Process.GetProcessesByName(name)) {
        if (p.MainWindowHandle != IntPtr.Zero) { hwnd = p.MainWindowHandle; return hwnd; }
      }
    }
    return hwnd;
  }

  public static string Grab(int w, int h) {
    IntPtr win = FindWow();
    if (win == IntPtr.Zero) return "NOWOW";
    if (IsIconic(win)) return "MIN";
    RECT rc; GetClientRect(win, out rc);
    w = Math.Min(w, rc.R - rc.L); h = Math.Min(h, rc.B - rc.T);
    if (w <= 0 || h <= 0) return "NOWOW";
    POINT p = new POINT(); ClientToScreen(win, ref p);
    using (Bitmap bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb)) {
      using (Graphics g = Graphics.FromImage(bmp)) { g.CopyFromScreen(p.X, p.Y, 0, 0, new Size(w, h)); }
      BitmapData d = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
      byte[] buf = new byte[w * h * 4];
      for (int y = 0; y < h; y++) Marshal.Copy(IntPtr.Add(d.Scan0, y * d.Stride), buf, y * w * 4, w * 4);
      bmp.UnlockBits(d);
      return "OK " + w + " " + h + " " + Convert.ToBase64String(buf);
    }
  }
}
"@
[CxwCapture]::Init()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $parts = $line.Split(' ')
  try {
    $out = [CxwCapture]::Grab([int]$parts[1], [int]$parts[2])
  } catch {
    $out = 'ERR ' + ($_.Exception.Message -replace '\s+', ' ')
  }
  [Console]::Out.WriteLine($out)
  [Console]::Out.Flush()
}
