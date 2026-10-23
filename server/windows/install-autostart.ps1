# Start the KingGnu server automatically when you sign in to Windows (no admin rights needed).
# Run:  powershell -ExecutionPolicy Bypass -File server\windows\install-autostart.ps1
$vbs = Join-Path $PSScriptRoot 'start-hidden.vbs'
$startup = [Environment]::GetFolderPath('Startup')
$lnk = Join-Path $startup 'KingGnu Server.lnk'
$sh = New-Object -ComObject WScript.Shell
$sc = $sh.CreateShortcut($lnk)
$sc.TargetPath = "$env:WINDIR\System32\wscript.exe"
$sc.Arguments = '"' + $vbs + '"'
$sc.WorkingDirectory = $PSScriptRoot
$sc.Description = 'KingGnu online battle server'
$sc.Save()
Write-Host "Registered: $lnk"
Start-Process -FilePath "$env:WINDIR\System32\wscript.exe" -ArgumentList ('"' + $vbs + '"')
Write-Host 'KingGnu server started in the background. Check: http://127.0.0.1:8787/health'
