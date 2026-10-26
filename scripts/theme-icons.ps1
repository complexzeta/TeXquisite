$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot 'logo-icon.ps1')
if(-not $?){throw 'Could not generate source icons'}
Add-Type -AssemblyName System.Drawing
$media=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\media'))
$original=[IO.File]::ReadAllBytes((Join-Path $media 'texquisite-icon.ico'))
$light=@();$dark=@()
function Encode-Png($bitmap){$stream=[IO.MemoryStream]::new();try{$bitmap.Save($stream,[Drawing.Imaging.ImageFormat]::Png);return ,$stream.ToArray()}finally{$stream.Dispose()}}
function Write-Ico($entries,$file){
 $stream=[IO.File]::Create($file);$writer=[IO.BinaryWriter]::new($stream)
 try{
  $writer.Write([uint16]0);$writer.Write([uint16]1);$writer.Write([uint16]$entries.Count);$offset=6+16*$entries.Count
  foreach($e in $entries){$dimension=if($e.Size -eq 256){0}else{$e.Size};$writer.Write([byte]$dimension);$writer.Write([byte]$dimension);$writer.Write([byte]0);$writer.Write([byte]0);$writer.Write([uint16]1);$writer.Write([uint16]32);$writer.Write([uint32]$e.Bytes.Length);$writer.Write([uint32]$offset);$offset+=$e.Bytes.Length}
  foreach($e in $entries){$writer.Write([byte[]]$e.Bytes)}
 }finally{$writer.Dispose();$stream.Dispose()}
}
for($i=0;$i -lt [BitConverter]::ToUInt16($original,4);$i++){
 $length=[BitConverter]::ToUInt32($original,6+16*$i+8);$offset=[BitConverter]::ToUInt32($original,6+16*$i+12)
 $stream=[IO.MemoryStream]::new($original,$offset,$length);$source=[Drawing.Bitmap]::new($stream);$size=$source.Width
 $outlined=[Drawing.Bitmap]::new($size,$size);$inverse=[Drawing.Bitmap]::new($size,$size)
 try{
  # A narrow opposite-color edge also works for static Explorer icons and
  # accent-colored surfaces whose shade differs from the Windows theme flag.
  $radius=[Math]::Max(1,[int][Math]::Round($size/64))
  $white=[Drawing.Imaging.ColorMatrix]::new();$white.Matrix00=0;$white.Matrix11=0;$white.Matrix22=0;$white.Matrix40=1;$white.Matrix41=1;$white.Matrix42=1
  $attributes=[Drawing.Imaging.ImageAttributes]::new();$attributes.SetColorMatrix($white)
  $g=[Drawing.Graphics]::FromImage($outlined)
  try{
   for($dy=-$radius;$dy -le $radius;$dy++){for($dx=-$radius;$dx -le $radius;$dx++){$g.DrawImage($source,[Drawing.Rectangle]::new($dx,$dy,$size,$size),0,0,$size,$size,[Drawing.GraphicsUnit]::Pixel,$attributes)}}
   $g.DrawImageUnscaled($source,0,0)
  }finally{$g.Dispose();$attributes.Dispose()}
  $invert=[Drawing.Imaging.ColorMatrix]::new();$invert.Matrix00=-1;$invert.Matrix11=-1;$invert.Matrix22=-1;$invert.Matrix40=1;$invert.Matrix41=1;$invert.Matrix42=1
  $attributes=[Drawing.Imaging.ImageAttributes]::new();$attributes.SetColorMatrix($invert);$g=[Drawing.Graphics]::FromImage($inverse)
  try{$g.DrawImage($outlined,[Drawing.Rectangle]::new(0,0,$size,$size),0,0,$size,$size,[Drawing.GraphicsUnit]::Pixel,$attributes)}finally{$g.Dispose();$attributes.Dispose()}
  $light+=@{Size=$size;Bytes=(Encode-Png $outlined)};$dark+=@{Size=$size;Bytes=(Encode-Png $inverse)}
 }finally{$outlined.Dispose();$inverse.Dispose();$source.Dispose();$stream.Dispose()}
}
Write-Ico $light (Join-Path $media 'texquisite-icon-light.ico')
Write-Ico $dark (Join-Path $media 'texquisite-icon-dark.ico')
# Executable resources are static; the outlined dark emblem remains visible
# on either background. The running window chooses its theme-specific icon.
Copy-Item -LiteralPath (Join-Path $media 'texquisite-icon-light.ico') -Destination (Join-Path $media 'texquisite-icon.ico') -Force
Write-Output 'Generated light/dark transparent emblem icons with contrasting edges.'
