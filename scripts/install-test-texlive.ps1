param(
  [Parameter(Mandatory=$true)][ValidateSet('2024','2025','2026')][string]$Year,
  [Parameter(Mandatory=$true)][string]$WorkRoot
)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($WorkRoot)
if($root -eq [IO.Path]::GetPathRoot($root)){throw 'Choose a dedicated test directory, not a drive root.'}
if(-not $env:CI){
  $drive=[IO.Path]::GetPathRoot($root).Substring(0,1)
  $volume=Get-Volume -DriveLetter $drive
  if($volume.FileSystemLabel -ne 'Kingston'){throw 'Local compatibility installations must be on Kingston.'}
}
foreach($name in @('downloads','temporary','installer')){New-Item -ItemType Directory -Path (Join-Path $root $name) -Force | Out-Null}
$env:TEMP=Join-Path $root 'temporary';$env:TMP=$env:TEMP
$env:LC_ALL='C';$env:LANG='C'
$repository=if($Year -eq '2026'){'https://ctan.math.illinois.edu/systems/texlive/tlnet'}else{"https://ftp.math.utah.edu/pub/tex/historic/systems/texlive/$Year/tlnet-final"}
$texdir=Join-Path $root 'texlive';$bin=Join-Path $texdir 'bin\windows'
if(Test-Path -LiteralPath (Join-Path $root 'installation.json')){throw 'Completed test installation already exists; use its recorded bin folder instead of overwriting it.'}
$zip=Join-Path $root 'downloads\install-tl.zip'
Write-Output "Downloading TeX Live $Year installer from $repository"
if(-not (Test-Path -LiteralPath $zip)){Invoke-WebRequest -Uri "$repository/install-tl.zip" -OutFile $zip -TimeoutSec 180}
$installerHash=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
$existing=@(Get-ChildItem -LiteralPath (Join-Path $root 'installer') -Recurse -File -Filter 'install-tl-windows.bat')
if(-not $existing.Count){Add-Type -AssemblyName System.IO.Compression.FileSystem;[IO.Compression.ZipFile]::ExtractToDirectory($zip,(Join-Path $root 'installer'))}
$launchers=@(Get-ChildItem -LiteralPath (Join-Path $root 'installer') -Recurse -File -Filter 'install-tl-windows.bat')
if($launchers.Count -ne 1){throw 'Expected one TeX Live installer entry point.'}
$dir=$texdir.Replace('\','/');$profile=Join-Path $root 'test.profile'
@"
selected_scheme scheme-basic
TEXDIR $dir
TEXMFLOCAL $dir/texmf-local
TEXMFSYSCONFIG $dir/texmf-config
TEXMFSYSVAR $dir/texmf-var
TEXMFCONFIG $dir/user/texmf-config
TEXMFVAR $dir/user/texmf-var
TEXMFHOME $dir/user/texmf-home
binary_windows 1
collection-basic 1
instopt_adjustpath 0
instopt_adjustrepo 0
instopt_portable 1
tlpdbopt_autobackup 0
tlpdbopt_install_docfiles 0
tlpdbopt_install_srcfiles 0
tlpdbopt_create_formats 1
tlpdbopt_desktop_integration 0
tlpdbopt_file_assocs 0
tlpdbopt_w32_multi_user 0
"@ | Set-Content -LiteralPath $profile -Encoding ascii
$beforeUserPath=[Environment]::GetEnvironmentVariable('Path','User')
$beforeMachinePath=[Environment]::GetEnvironmentVariable('Path','Machine')
Push-Location $root
try{
  if(-not (Test-Path -LiteralPath (Join-Path $bin 'tlmgr.bat'))){
    & $launchers[0].FullName -no-gui -portable -profile $profile -repository $repository
    if($LASTEXITCODE -ne 0){throw "TeX Live $Year installation failed ($LASTEXITCODE). See the installation log."}
  }
  $version=(& (Join-Path $bin 'pdftex.exe') --version | Out-String)
  if($version -notmatch "TeX Live $Year"){throw 'Repository version does not match the requested test year.'}
  # Only this shell sees the test bin. No registry, desktop or global PATH edits.
  $env:PATH=$bin+';'+$env:PATH
  & (Join-Path $bin 'tlmgr.bat') --repository $repository install collection-latex latexmk amsmath tools graphics pgf xcolor geometry hyperref babel-english ec
  if($LASTEXITCODE -ne 0){throw 'Installing the compatibility fixture packages failed.'}
  if(-not (Test-Path -LiteralPath (Join-Path $bin 'pdflatex.exe'))){throw 'The LaTeX collection did not provide pdfLaTeX.'}
  if([Environment]::GetEnvironmentVariable('Path','User') -ne $beforeUserPath -or [Environment]::GetEnvironmentVariable('Path','Machine') -ne $beforeMachinePath){throw 'The installer unexpectedly changed persistent PATH.'}
  @{year=$Year;repository=$repository;bin=$bin;installerSha256=$installerHash;version=$version.Trim();completed=[DateTime]::UtcNow.ToString('o');persistentPathUnchanged=$true} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'installation.json')
  Write-Output "Isolated TeX Live $Year ready: $bin"
}finally{Pop-Location}
