@echo off
setlocal
set "PERSISTENT_TEX_MULTI_BLOCK=1"
set "PERSISTENT_TEX_TEST_DATA=%~dp0profile"
set "TEMP=%~dp0temporary"
set "TMP=%TEMP%"
if not exist "%TEMP%" mkdir "%TEMP%"
if not exist "%~dp0TeXquisite-0.101.0-Windows.exe" (
  echo Keep this launcher beside TeXquisite-0.101.0-Windows.exe.
  pause
  exit /b 1
)
start "" "%~dp0TeXquisite-0.101.0-Windows.exe" %*
