Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot

function Resize-Png([string]$source, [string]$target, [int]$size) {
  $image = [System.Drawing.Image]::FromFile($source)
  try {
    $bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.Clear([System.Drawing.Color]::Transparent)
      $graphics.DrawImage($image, 0, 0, $size, $size)
    } finally {
      $graphics.Dispose()
    }
    $bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
    $bitmap.Dispose()
  } finally {
    $image.Dispose()
  }
}

$source = Join-Path $root 'docs/icons/icon-512.png'
Resize-Png $source (Join-Path $root 'docs/icons/icon-192.png') 192
Resize-Png $source (Join-Path $root 'docs/icons/apple-touch-icon.png') 180
Write-Output 'icons resized: 192x192, 180x180'
