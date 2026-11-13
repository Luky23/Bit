# win-input.ps1 — Helper FIJO de automatización de Windows para Bit.
#
# Verbos cerrados (ValidateSet). Los argumentos llegan por argv literal desde
# win-automation.mjs ya validados: sin shell libre, sin código externo, sin red.
# Este archivo no interpreta comandos del modelo; solo ejecuta estas cuatro
# operaciones de user32/SendKeys y responde por stdout con JSON.
#
# Salida: una línea JSON { ok: true, ... } | errores por stderr con exit 1.

param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet("list", "focus", "key", "click")]
  [string]$Verb,

  [Parameter(Position = 1)]
  [string]$Arg1 = "",

  [Parameter(Position = 2)]
  [string]$Arg2 = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$nativeSource = @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace BitWin32 {
public static class Native {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);

    [DllImport("user32.dll")]
    public static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();

    // Devuelve filas [hwnd, pid, título] de ventanas visibles con título.
    public static List<string[]> EnumerateVisibleTitles() {
        var rows = new List<string[]>();
        EnumWindows((hWnd, lParam) => {
            if (!IsWindowVisible(hWnd)) return true;
            int length = GetWindowTextLength(hWnd);
            if (length <= 0) return true;
            var title = new StringBuilder(length + 1);
            GetWindowText(hWnd, title, title.Capacity);
            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            rows.Add(new string[] { hWnd.ToInt64().ToString(), pid.ToString(), title.ToString() });
            return true;
        }, IntPtr.Zero);
        return rows;
    }

    // Devuelve true si encontró y enfocó una ventana cuyo título contiene needle.
    public static bool FocusByTitle(string needle) {
        IntPtr target = IntPtr.Zero;
        EnumWindows((hWnd, lParam) => {
            if (!IsWindowVisible(hWnd)) return true;
            int length = GetWindowTextLength(hWnd);
            if (length <= 0) return true;
            var title = new StringBuilder(length + 1);
            GetWindowText(hWnd, title, title.Capacity);
            if (title.ToString().IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0) {
                target = hWnd;
                return false;
            }
            return true;
        }, IntPtr.Zero);

        if (target == IntPtr.Zero) return false;

        if (IsIconic(target)) {
            ShowWindow(target, 9); // SW_RESTORE
        }

        // Truco de la tecla ALT: Windows libera el bloqueo de foreground con
        // un evento ALT antes de SetForegroundWindow.
        keybd_event(0x12, 0, 0, UIntPtr.Zero); // ALT down
        keybd_event(0x12, 0, 2, UIntPtr.Zero); // ALT up

        uint targetThread;
        GetWindowThreadProcessId(target, out targetThread);
        uint currentThread = GetCurrentThreadId();
        AttachThreadInput(currentThread, targetThread, true);
        SetForegroundWindow(target);
        AttachThreadInput(currentThread, targetThread, false);

        return GetForegroundWindow() == target;
    }

    public static bool ClickAt(int x, int y) {
        if (!SetCursorPos(x, y)) return false;
        System.Threading.Thread.Sleep(60);
        mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero); // LEFTDOWN
        System.Threading.Thread.Sleep(40);
        mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero); // LEFTUP
        return true;
    }
}
}
"@
Add-Type -TypeDefinition $nativeSource

function Write-Ok([hashtable]$Payload) {
    $Payload["ok"] = $true
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject $Payload -Compress -Depth 6))
}

try {
    switch ($Verb) {
        "list" {
            $windows = @()
            foreach ($row in [BitWin32.Native]::EnumerateVisibleTitles()) {
                $procName = ""
                try {
                    $procName = (Get-Process -Id ([uint32]$row[1]) -ErrorAction Stop).ProcessName
                } catch {
                    $procName = ""
                }
                $title = $row[2]
                if ($title.Length -gt 300) { $title = $title.Substring(0, 300) }
                $windows += @{
                    hwnd     = [int64]$row[0]
                    pid      = [int]$row[1]
                    process  = $procName
                    title    = $title
                }
            }
            Write-Ok @{ windows = $windows }
        }

        "focus" {
            $focused = [BitWin32.Native]::FocusByTitle($Arg1)
            Write-Ok @{ focused = [bool]$focused; needle = $Arg1 }
        }

        "key" {
            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.SendKeys]::SendWait($Arg1)
            Start-Sleep -Milliseconds 150
            Write-Ok @{}
        }

        "click" {
            $x = [int]$Arg1
            $y = [int]$Arg2
            if (-not [BitWin32.Native]::ClickAt($x, $y)) {
                throw "SetCursorPos falló en ($x, $y)"
            }
            Write-Ok @{}
        }
    }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
