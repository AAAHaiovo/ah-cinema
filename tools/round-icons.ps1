# Add iOS-style squircle corners to PWA icons (purpose="any" and apple-touch-icon).
# icon-maskable-512.png stays full-bleed so Android launchers can mask it themselves.

param(
  [string]$Dir = (Join-Path $PSScriptRoot '..\docs\icons')
)

Add-Type -AssemblyName System.Drawing

$targets = @('icon-192.png', 'icon-512.png', 'apple-touch-icon.png')

foreach ($name in $targets) {
  $file = Join-Path $Dir $name
  if (-not (Test-Path $file)) {
    Write-Warning ("missing " + $file)
    continue
  }

  $src = [System.Drawing.Image]::FromFile($file)
  $size = [int]$src.Width
  if ([int]$src.Height -ne $size) {
    Write-Warning ($name + " is not square")
    $src.Dispose()
    continue
  }

  $bmp = New-Object System.Drawing.Bitmap -ArgumentList $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bmp)
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  # Superellipse |x|^n + |y|^n = 1. n=5 gives about 22% corner radius, close to iOS.
  $shape = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $half = $size / 2.0
  $steps = [Math]::Max(360, $size * 2)
  $points = New-Object 'System.Drawing.PointF[]' $steps
  for ($i = 0; $i -lt $steps; $i++) {
    $t = 2.0 * [Math]::PI * $i / $steps
    $cos = [Math]::Cos($t)
    $sin = [Math]::Sin($t)
    $x = $half + $half * [Math]::Sign($cos) * [Math]::Pow([Math]::Abs($cos), 0.4)
    $y = $half + $half * [Math]::Sign($sin) * [Math]::Pow([Math]::Abs($sin), 0.4)
    $points[$i] = [System.Drawing.PointF]::new([single]$x, [single]$y)
  }
  $shape.AddPolygon($points)

  $graphics.SetClip($shape)
  $graphics.DrawImage($src, 0, 0, $size, $size)
  $graphics.ResetClip()

  $graphics.Dispose()
  $src.Dispose()
  $shape.Dispose()

  $temp = Join-Path $Dir ($name + '.tmp.png')
  $bmp.Save($temp, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Move-Item -Force $temp $file

  Write-Host ("rounded " + $name + " (" + $size + "x" + $size + ")")
}
