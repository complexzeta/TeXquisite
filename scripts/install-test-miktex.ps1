param([Parameter(Mandatory=$true)][string]$WorkRoot)
$ErrorActionPreference='Stop'
if($env:CI -ne 'true'){throw 'MiKTeX installation is cloud-only; this script refuses local execution.'}
$root=[IO.Path]::GetFullPath($WorkRoot)
if(-not $root.StartsWith([IO.Path]::GetFullPath($env:RUNNER_TEMP)+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Installation must stay inside RUNNER_TEMP'}
New-Item -ItemType Directory -Path $root -Force | Out-Null
$result=[ordered]@{passed=$false;installer='basic-miktex-25.12-x64.exe';installerSha256='14b42dd9f4b4a7813a8bfd69c8f99316c2888cc4ee26f631f397e163d85d6c62';cloudOnly=$true}
try {
 $installer=Join-Path $root $result.installer
 Invoke-WebRequest -Uri 'https://miktex.org/download/ctan/systems/win32/miktex/setup/windows-x64/basic-miktex-25.12-x64.exe' -OutFile $installer -TimeoutSec 300
 if((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $result.installerSha256){throw 'Official installer checksum mismatch'}
 $install=Join-Path $root 'MiKTeX with spaces';$config=Join-Path $root 'config';$data=Join-Path $root 'data'
 $installerArguments=@('--unattended','--private','--no-registry','--no-additional-roots',('--user-install="'+$install+'"'),('--user-config="'+$config+'"'),('--user-data="'+$data+'"'))
 $process=Start-Process -FilePath $installer -ArgumentList $installerArguments -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput "$root/installer-stdout.log" -RedirectStandardError "$root/installer-stderr.log"
 # Start-Process -Wait follows the bootstrap installer and its children.
 if($process.ExitCode -ne 0){throw "MiKTeX installer exit $($process.ExitCode)"}
 $executables=@(Get-ChildItem -LiteralPath $install -Recurse -File -Filter '*.exe')
 $result.executableSample=@($executables | Select-Object -First 20 | ForEach-Object {[IO.Path]::GetRelativePath($install,$_.FullName)})
 $pdf=@($executables | Where-Object Name -eq 'pdflatex.exe')
 if($pdf.Count -ne 1){throw "Expected one installed pdflatex; found $($pdf.Count). See executableSample."}
 $bin=$pdf[0].DirectoryName
 $perl=(Get-Command perl -ErrorAction Stop).Source;$perlBin=Split-Path -Parent $perl
 $env:PATH="$bin;$perlBin;$env:SystemRoot/System32;$env:SystemRoot;$(Split-Path -Parent (Get-Command node).Source)"
 $repo='https://mirror.ctan.org/systems/win32/miktex/tm/packages/'
 function Invoke-MiKTeX([string]$Name,[string[]]$Arguments){
  & "$bin/$Name.exe" @Arguments 2>&1 | Tee-Object -FilePath "$root/setup.log" -Append | Write-Output
  if($LASTEXITCODE -ne 0){throw "$Name failed with exit $LASTEXITCODE"}
 }
 Invoke-MiKTeX initexmf @('--set-config-value=[MPM]AutoInstall=0')
 Invoke-MiKTeX mpm @("--set-repository=$repo")
 Invoke-MiKTeX miktex @('packages','update-package-database','--repository',$repo)
 Invoke-MiKTeX miktex @('packages','update','--repository',$repo)
 Invoke-MiKTeX miktex @('packages','install','--repository',$repo,'latexmk','amsmath','graphics','pgf','hyperref','geometry')
 Invoke-MiKTeX initexmf @('--update-fndb')
 Invoke-MiKTeX initexmf @('--mkmaps')
 $warm=Join-Path $root 'warmup';New-Item -ItemType Directory -Path $warm | Out-Null
 '\documentclass{article}\usepackage{amsmath,graphicx,tikz,hyperref}\begin{document}Warmup $\sqrt\pi$.\begin{tikzpicture}\draw(0,0)--(1,1);\end{tikzpicture}\end{document}' | Set-Content -LiteralPath "$warm/main.tex" -Encoding ascii
 Push-Location $warm
 try{Invoke-MiKTeX pdflatex @('--disable-installer','-interaction=nonstopmode','-halt-on-error','main.tex')}finally{Pop-Location}
 $result.bin=$bin;$result.installRoot=$install;$result.perl=$perl;$result.repository=$repo;$result.version=(& "$bin/pdflatex.exe" --version | Select-Object -First 1);$result.passed=$true
 "TEXQUISITE_TEST_TEX_BIN=$bin" >> $env:GITHUB_ENV
 "TEXQUISITE_TEST_MIKTEX_ROOT=$install" >> $env:GITHUB_ENV
 "TEXQUISITE_TEST_PERL_BIN=$perlBin" >> $env:GITHUB_ENV
 "TEXQUISITE_TEST_MIKTEX_REPOSITORY=$repo" >> $env:GITHUB_ENV
 "$bin" >> $env:GITHUB_PATH
 "$perlBin" >> $env:GITHUB_PATH
}catch{$result.error=$_.ToString();$result.stack=$_.ScriptStackTrace;throw}finally{$result.installDirectories=@(Get-ChildItem -LiteralPath $root -Directory | Select-Object -ExpandProperty Name);$traces=@(Get-ChildItem -LiteralPath $env:TEMP -File -Recurse -Filter '*.log' -ErrorAction SilentlyContinue | Select-Object -First 8);foreach($trace in $traces){("Trace: "+$trace.Name) | Out-File -LiteralPath "$root/bootstrap-trace.log" -Append;Get-Content -LiteralPath $trace.FullName -Tail 100 | Out-File -LiteralPath "$root/bootstrap-trace.log" -Append};$result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath "$root/installation.json" -Encoding utf8}
