@echo off
rem Installs the Rust Legacy game loader for this Windows user, from the folder this file is in (no administrator rights).
rem Double-click it after extracting the RustLegacyLoader zip. Uninstall it from Windows Settings, Apps.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-RustLegacyLauncher.ps1" -Apply
echo.
pause
