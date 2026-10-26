param([string]$ReleaseDirectory = (Join-Path $PSScriptRoot '..\release'))
$ErrorActionPreference = 'Stop'
function Get-BuildHash([string]$File) {
  $algorithm = [Security.Cryptography.SHA256]::Create()
  $stream = [IO.File]::OpenRead($File)
  try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '') }
  finally { $stream.Dispose(); $algorithm.Dispose() }
}
$releasePath = [IO.Path]::GetFullPath($ReleaseDirectory)
if (-not (Test-Path -LiteralPath $releasePath -PathType Container)) { return }
$volumes = @(Get-Volume | Where-Object { $_.FileSystemLabel -eq 'Kingston' -and $_.DriveLetter })
if ($volumes.Count -eq 0) { Write-Host 'Build archive: Kingston is absent; keeping existing builds locally.'; return }
if ($volumes.Count -ne 1) { throw 'More than one Kingston volume is present. Cannot choose an archive destination safely.' }
$driveRoot = "$($volumes[0].DriveLetter):\"
$archiveRoot = [IO.Path]::GetFullPath((Join-Path $driveRoot 'Persistent-TeX\build-archive'))
if (-not $archiveRoot.StartsWith($driveRoot, [StringComparison]::OrdinalIgnoreCase) -or $archiveRoot -eq $driveRoot) { throw 'Unsafe archive destination.' }
$builds = @(Get-ChildItem -LiteralPath $releasePath -File | ForEach-Object {
  if ($_.Name -match '^(?:Persistent-TeX|TeXquisite)-(\d+\.\d+\.\d+)-Windows\.exe$') {
    [pscustomobject]@{ File = $_; Version = [version]$Matches[1]; VersionText = $Matches[1] }
  }
} | Sort-Object Version -Descending)
if ($builds.Count -lt 2) { Write-Host 'Build archive: Kingston present; only the latest portable build is local.'; return }
foreach ($build in ($builds | Select-Object -Skip 1)) {
  $versionDirectory = Join-Path $archiveRoot $build.VersionText
  New-Item -ItemType Directory -Path $versionDirectory -Force | Out-Null
  $files = @($build.File)
  foreach ($name in @("TEST-REPORT-$($build.VersionText).md", "README-$($build.VersionText).md", "SHA256SUMS-$($build.VersionText).txt")) {
    $companion = Join-Path $releasePath $name
    if (Test-Path -LiteralPath $companion -PathType Leaf) { $files += Get-Item -LiteralPath $companion }
  }
  foreach ($file in $files) {
    $source = [IO.Path]::GetFullPath($file.FullName)
    if ([IO.Path]::GetDirectoryName($source) -ne $releasePath) { throw 'Archive source escaped the release directory.' }
    $destination = [IO.Path]::GetFullPath((Join-Path $versionDirectory $file.Name))
    if (-not $destination.StartsWith($archiveRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Archive destination escaped the archive directory.' }
    $sourceHash = Get-BuildHash $source
    if (Test-Path -LiteralPath $destination) {
      if ((Get-BuildHash $destination) -ne $sourceHash) { throw "Archive already contains different bytes: $destination" }
      Remove-Item -LiteralPath $source
    } else {
      # Verify a cross-drive copy before removing the local source. A failed
      # copy leaves the source intact; an interrupted .partial is never a build.
      $temporary = $destination + '.partial'
      Copy-Item -LiteralPath $source -Destination $temporary -Force
      if ((Get-BuildHash $temporary) -ne $sourceHash) { throw "Archive verification failed: $source" }
      Move-Item -LiteralPath $temporary -Destination $destination
      Remove-Item -LiteralPath $source
    }
    Write-Host "Archived $($file.Name) -> $destination"
  }
}
Write-Host "Build archive: kept $($builds[0].File.Name) locally."
