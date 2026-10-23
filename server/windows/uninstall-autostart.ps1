# Remove the auto start shortcut (does not stop a running server; use stop-server.cmd)
# Run:  powershell -ExecutionPolicy Bypass -File server\windows\uninstall-autostart.ps1
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'KingGnu Server.lnk'
if (Test-Path $lnk) { Remove-Item $lnk; Write-Host "Removed: $lnk" } else { Write-Host 'Auto start was not registered.' }
