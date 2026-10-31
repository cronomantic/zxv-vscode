# capture-window.ps1 - Captura la ventana principal de un proceso (la de VS
# Code que hace las capturas del README) a un PNG (-Out), aunque esté tapada
# (PrintWindow). Con -Width y -Height, antes la pone de ese tamaño (en píxeles
# lógicos: a 150 %, 1280 son 1920 de verdad). -CropTop quita esos píxeles
# lógicos de arriba: la barra del título, que en las pruebas dice
# «[Extension Development Host]». -Activate la pone delante y con el foco
# (sin él, VS Code no enseña el hover ni despliega las listas).
param(
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [string]$Out = '',
    [int]$Width = 0,
    [int]$Height = 0,
    [int]$CropTop = 0,
    [switch]$Activate
)
$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class ZxvCapture {
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr lParam);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT r);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int w, int h, uint flags);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int cmd);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

    static IntPtr Find(uint pid) {
        IntPtr best = IntPtr.Zero; long area = 0;
        EnumWindows((h, l) => {
            uint p; GetWindowThreadProcessId(h, out p);
            RECT r;
            if (p == pid && IsWindowVisible(h) && GetWindowRect(h, out r)) {
                long a = (long)(r.Right - r.Left) * (r.Bottom - r.Top);
                if (a > area) { area = a; best = h; }
            }
            return true;
        }, IntPtr.Zero);
        return best;
    }

    public static string Run(int pid, string file, int w, int h, int top, bool activate) {
        SetProcessDpiAwarenessContext(new IntPtr(-4));  // per monitor v2: píxeles de verdad
        IntPtr hwnd = Find((uint)pid);
        if (hwnd == IntPtr.Zero)
            throw new Exception("no hay ventana del proceso " + pid);
        if (w > 0 && h > 0) {
            double s = GetDpiForWindow(hwnd) / 96.0;
            ShowWindow(hwnd, 9);  // SW_RESTORE: sin maximizar
            SetWindowPos(hwnd, IntPtr.Zero, 40, 40, (int)(w * s), (int)(h * s), 0x0004 | 0x0010);  // NOZORDER, NOACTIVATE
            System.Threading.Thread.Sleep(1500);
        }
        if (activate) {
            /* Windows solo deja dar el foco a quien recibió la última entrada:
             * una pulsación de Alt lo permite. */
            keybd_event(0x12, 0, 0, UIntPtr.Zero);
            keybd_event(0x12, 0, 2, UIntPtr.Zero);
            SetForegroundWindow(hwnd);
        }
        if (file == "")
            return "";
        RECT r; GetWindowRect(hwnd, out r);
        int cut = (int)(top * GetDpiForWindow(hwnd) / 96.0);
        using (var bmp = new Bitmap(r.Right - r.Left, r.Bottom - r.Top, PixelFormat.Format32bppArgb)) {
            using (var g = Graphics.FromImage(bmp)) {
                IntPtr hdc = g.GetHdc();
                PrintWindow(hwnd, hdc, 2);  // PW_RENDERFULLCONTENT: también lo de Chromium
                g.ReleaseHdc(hdc);
            }
            using (var part = bmp.Clone(new Rectangle(0, cut, bmp.Width, bmp.Height - cut), bmp.PixelFormat))
                part.Save(file, ImageFormat.Png);
            return bmp.Width + "x" + (bmp.Height - cut);
        }
    }
}
'@
[ZxvCapture]::Run($ProcessId, $Out, $Width, $Height, $CropTop, $Activate.IsPresent)
