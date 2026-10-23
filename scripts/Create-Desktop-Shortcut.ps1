$WshShell = New-Object -ComObject WScript.Shell
$DesktopPath = [System.Environment]::GetFolderPath('Desktop')
$ShortcutPath = Join-Path $DesktopPath "CONCLAVE.lnk"
$TargetDir = Split-Path -Parent $PSScriptRoot
$TargetExe = Join-Path $TargetDir "conclave-gui.exe"
$IconPath = Join-Path $TargetDir "conclave.ico"

if (-not (Test-Path $TargetExe)) {
    $TargetExe = Join-Path $TargetDir "conclave.exe"
}

$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $TargetExe
$Shortcut.WorkingDirectory = $TargetDir
$Shortcut.IconLocation = "$IconPath, 0"
$Shortcut.Description = "CONCLAVE - Multi-Agent Desktop AI Hub"
$Shortcut.Save()

Write-Host "Created Desktop Shortcut: $ShortcutPath"
