Add-Type -AssemblyName System.Drawing

$projectRoot = $PSScriptRoot | Split-Path -Parent
$sourceLogoPath = Join-Path $projectRoot "logo.png"

if (-not (Test-Path $sourceLogoPath)) {
    Write-Error "source logo.png not found at $sourceLogoPath"
    exit 1
}

$srcImg = [System.Drawing.Image]::FromFile($sourceLogoPath)
$srcW = $srcImg.Width
$srcH = $srcImg.Height
Write-Host "Source logo loaded: ${srcW}x${srcH}"

function Resize-To-Square-Png {
    param(
        [System.Drawing.Image]$source,
        [int]$targetSize,
        [string]$outputPath
    )

    $bmp = New-Object System.Drawing.Bitmap($targetSize, $targetSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

    # Fit source inside target square with aspect ratio preserved
    $scale = [Math]::Min($targetSize / $source.Width, $targetSize / $source.Height)
    $destW = [int][Math]::Round($source.Width * $scale)
    $destH = [int][Math]::Round($source.Height * $scale)
    $destX = [int][Math]::Round(($targetSize - $destW) / 2)
    $destY = [int][Math]::Round(($targetSize - $destH) / 2)

    $rect = New-Object System.Drawing.Rectangle($destX, $destY, $destW, $destH)
    $g.DrawImage($source, $rect, 0, 0, $source.Width, $source.Height, [System.Drawing.GraphicsUnit]::Pixel)

    $g.Dispose()

    $parentDir = Split-Path -Parent $outputPath
    if (-not (Test-Path $parentDir)) {
        New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
    }

    $bmp.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "Generated: $outputPath (${targetSize}x${targetSize})"
}

# 1. Output sizes needed
$tempDir = Join-Path $projectRoot "tools\temp_icons"
if (-not (Test-Path $tempDir)) { New-Item -ItemType Directory -Path $tempDir -Force | Out-Null }

$sizes = @(16, 32, 48, 64, 128, 180, 256, 512, 1024)
foreach ($s in $sizes) {
    Resize-To-Square-Png -source $srcImg -targetSize $s -outputPath (Join-Path $tempDir "icon_${s}.png")
}

# Copy to final destinations
Copy-Item (Join-Path $tempDir "icon_1024.png") (Join-Path $projectRoot "build\icon.png") -Force
Copy-Item (Join-Path $tempDir "icon_512.png") (Join-Path $projectRoot "docs\logo.png") -Force
Copy-Item (Join-Path $tempDir "icon_512.png") (Join-Path $projectRoot "docs\logo-light.png") -Force
Copy-Item (Join-Path $tempDir "icon_180.png") (Join-Path $projectRoot "docs\apple-touch-icon.png") -Force
Copy-Item (Join-Path $tempDir "icon_48.png") (Join-Path $projectRoot "docs\favicon-48.png") -Force
Copy-Item (Join-Path $tempDir "icon_32.png") (Join-Path $projectRoot "docs\favicon-32.png") -Force

$srcImg.Dispose()
Write-Host "All raster sizes generated successfully."
