Add-Type -AssemblyName System.Drawing

# 把 AH 图标从「墨黑底 + 白标记」改成「品牌红底 + 白标记」。
# 使用亮度做线性映射，抗锯齿边缘会自然过渡到红白之间。

$root = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $root 'AH标识图/4-App图标.png'
$iconPath = Join-Path $root 'docs/icons/icon-512.png'
$maskablePath = Join-Path $root 'docs/icons/icon-maskable-512.png'

$redR = 201.0
$redG = 47.0
$redB = 54.0
$bgLum = 18.0

if (-not (Test-Path -LiteralPath $sourcePath)) {
  throw "找不到原始图标：$sourcePath"
}

$source = [System.Drawing.Bitmap]::FromFile($sourcePath)
$width = $source.Width
$height = $source.Height

$bitmap = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.DrawImage($source, 0, 0, $width, $height)
$graphics.Dispose()
$source.Dispose()

$rect = New-Object System.Drawing.Rectangle(0, 0, $width, $height)
$data = $bitmap.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$bytes = New-Object byte[] ($data.Stride * $height)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)

for ($y = 0; $y -lt $height; $y++) {
  $row = $y * $data.Stride
  for ($x = 0; $x -lt $width; $x++) {
    $i = $row + $x * 4
    $b = [double]$bytes[$i]
    $g = [double]$bytes[$i + 1]
    $r = [double]$bytes[$i + 2]
    $lum = ($r + $g + $b) / 3.0
    $t = ($lum - $bgLum) / (255.0 - $bgLum)
    if ($t -lt 0) { $t = 0 }
    if ($t -gt 1) { $t = 1 }

    $bytes[$i] = [byte][math]::Round($redB + (255.0 - $redB) * $t)
    $bytes[$i + 1] = [byte][math]::Round($redG + (255.0 - $redG) * $t)
    $bytes[$i + 2] = [byte][math]::Round($redR + (255.0 - $redR) * $t)
    $bytes[$i + 3] = 255
  }
}

[System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
$bitmap.UnlockBits($data)
$bitmap.Save($iconPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()

# 安卓圆形/异形图标：标记缩到画布边长的约 56%，避免被裁掉 A 的左脚。
$mark = [System.Drawing.Image]::FromFile($iconPath)
$canvas = New-Object System.Drawing.Bitmap(512, 512, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($canvas)
try {
  $graphics.Clear([System.Drawing.Color]::FromArgb(255, [int]$redR, [int]$redG, [int]$redB))
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.DrawImage($mark, 51, 51, 410, 410)
} finally {
  $graphics.Dispose()
  $mark.Dispose()
}
$canvas.Save($maskablePath, [System.Drawing.Imaging.ImageFormat]::Png)
$canvas.Dispose()

Write-Output 'red icon written: icon-512.png, icon-maskable-512.png'
