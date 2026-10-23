$ErrorActionPreference = "Stop"

$installDir = "$env:LOCALAPPDATA\Programs\Conclave"
$distUnpacked = Join-Path $PSScriptRoot "..\dist\win-unpacked"

Write-Host "1. Terminating any running Conclave processes..."
Get-Process Conclave -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

Write-Host "2. Copying built files to $installDir..."
if (-not (Test-Path $installDir)) {
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
}

Copy-Item -Path "$distUnpacked\*" -Destination $installDir -Recurse -Force

Write-Host "3. Placing icon files..."
$icoSrc = Join-Path $PSScriptRoot "..\build\icon.ico"
$targetIco = Join-Path $installDir "app.ico"
Copy-Item -Path $icoSrc -Destination $targetIco -Force
Copy-Item -Path $icoSrc -Destination (Join-Path $installDir "Conclave.ico") -Force

Write-Host "4. Patching PE executable in install directory..."
node "$PSScriptRoot\patch-pe-icon.cjs"

Write-Host "5. Updating Desktop & Start Menu shortcuts..."
$wscript = New-Object -ComObject WScript.Shell
$desktop = [System.Environment]::GetFolderPath("Desktop")
$startMenu = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs"

$shortcuts = @(
    (Join-Path $desktop "Conclave.exe - Shortcut.lnk"),
    (Join-Path $desktop "Conclave.lnk"),
    (Join-Path $startMenu "Conclave.lnk")
)

foreach ($scPath in $shortcuts) {
    try {
        $shortcut = $wscript.CreateShortcut($scPath)
        $shortcut.TargetPath = Join-Path $installDir "Conclave.exe"
        $shortcut.WorkingDirectory = $installDir
        $shortcut.IconLocation = "$targetIco,0"
        $shortcut.Description = "Conclave"
        $shortcut.Save()
        Write-Host "  Updated shortcut: $scPath"
    } catch {
        Write-Warning "  Failed to update shortcut $scPath : $_"
    }
}

Write-Host "6. Refreshing Windows Icon Cache and Shell..."
try {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class ShellNotifier {
    [DllImport("shell32.dll")]
    public static extern void SHChangeNotify(int wEventId, int uFlags, IntPtr dwItem1, IntPtr dwItem2);
}
"@ -ErrorAction SilentlyContinue
} catch {}

try {
    [ShellNotifier]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
    Write-Host "  SHChangeNotify executed."
} catch {
    Write-Warning "  SHChangeNotify error: $_"
}

try {
    Start-Process -FilePath "ie4uinit.exe" -ArgumentList "-show" -Wait -ErrorAction SilentlyContinue
} catch {}

Write-Host "Local deployment and icon cache refresh complete!"
