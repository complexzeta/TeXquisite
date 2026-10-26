$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$logo = [Drawing.Image]::FromFile((Join-Path $PSScriptRoot '..\media\texquisite-emblem.png'))
$entries = @()
try {
  foreach ($size in @(16,24,32,48,64,128,256)) {
    $bitmap = [Drawing.Bitmap]::new($size,$size)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.Clear([Drawing.Color]::Transparent)
      $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $scale = [Math]::Min($size / $logo.Width, $size / $logo.Height)
      $width = [Math]::Max(1,[int]($logo.Width * $scale))
      $height = [Math]::Max(1,[int]($logo.Height * $scale))
      $graphics.DrawImage($logo,[int](($size-$width)/2),[int](($size-$height)/2),$width,$height)
      $stream = [IO.MemoryStream]::new()
      try { $bitmap.Save($stream,[Drawing.Imaging.ImageFormat]::Png); $entries += @{ Size=$size; Bytes=$stream.ToArray() } }
      finally { $stream.Dispose() }
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
  }
  $output = [IO.File]::Create((Join-Path $PSScriptRoot '..\media\texquisite-icon.ico'))
  $writer = [IO.BinaryWriter]::new($output)
  try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$entries.Count)
    $offset = 6+16*$entries.Count
    foreach ($entry in $entries) {
      $dimension = if ($entry.Size -eq 256) { 0 } else { $entry.Size }
      $writer.Write([byte]$dimension); $writer.Write([byte]$dimension); $writer.Write([byte]0); $writer.Write([byte]0)
      $writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$entry.Bytes.Length); $writer.Write([uint32]$offset)
      $offset += $entry.Bytes.Length
    }
    foreach ($entry in $entries) { $writer.Write([byte[]]$entry.Bytes) }
  } finally { $writer.Dispose(); $output.Dispose() }
} finally { $logo.Dispose() }
