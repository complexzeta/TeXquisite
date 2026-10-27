param([Parameter(Mandatory=$true)][string]$WorkRoot,[string]$LocalPortable)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($WorkRoot)
if($root -eq [IO.Path]::GetPathRoot($root)){throw 'Choose a dedicated test directory.'}
if(-not $env:CI){$volume=Get-Volume -DriveLetter ([IO.Path]::GetPathRoot($root).Substring(0,1));if($volume.FileSystemLabel -ne 'Kingston'){throw 'Local package tests must stay on Kingston.'}}
foreach($name in @('downloads','outer','runtime','temporary')){New-Item -ItemType Directory -Path (Join-Path $root $name) -Force | Out-Null}
$env:TEMP=Join-Path $root 'temporary';$env:TMP=$env:TEMP
$expected='c2039a42edf4e3558325cd2ce3f5ca2f4c9b2a869c03084cb5b5ba60f4cb4b2c'
$portable=if($LocalPortable){[IO.Path]::GetFullPath($LocalPortable)}else{Join-Path $root 'downloads\TeXquisite-0.95.0-Windows.exe'}
if(-not $LocalPortable -and -not (Test-Path -LiteralPath $portable)){Invoke-WebRequest -Uri 'https://github.com/complexzeta/TeXquisite/releases/download/v0.95.0/TeXquisite-0.95.0-Windows.exe' -OutFile $portable -TimeoutSec 300}
if((Get-FileHash -LiteralPath $portable -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected){throw 'Published portable checksum mismatch.'}
$sevenZip=Join-Path $env:ProgramFiles '7-Zip\7z.exe'
if(-not (Test-Path -LiteralPath $sevenZip)){throw '7-Zip is required to inspect the published portable without installing it.'}
& $sevenZip x $portable "-o$(Join-Path $root 'outer')" -y | Out-Null
if($LASTEXITCODE -ne 0){throw 'Portable archive extraction failed.'}
$inner=@(Get-ChildItem -LiteralPath (Join-Path $root 'outer') -Recurse -File -Filter 'app-64.7z');if($inner.Count -ne 1){throw 'Unexpected portable archive layout.'}
& $sevenZip x $inner[0].FullName "-o$(Join-Path $root 'runtime')" -y | Out-Null
if($LASTEXITCODE -ne 0){throw 'Application payload extraction failed.'}
$exe=Join-Path $root 'runtime\TeXquisite.exe';if(-not (Test-Path -LiteralPath $exe)){throw 'Published runtime missing.'}
@{version='0.95.0';portableSha256=$expected;asarSha256=(Get-FileHash -LiteralPath (Join-Path $root 'runtime\resources\app.asar')).Hash.ToLowerInvariant()} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'portable-package.json')
Write-Output $exe
