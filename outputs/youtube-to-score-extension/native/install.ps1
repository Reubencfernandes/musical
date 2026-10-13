# Registers the yt-dlp helper with Chrome for this Windows user (no admin rights needed).
# Run:  powershell -ExecutionPolicy Bypass -File native\install.ps1
# Only the extension with this ID may talk to the helper; the ID comes from the
# folder the extension is loaded from (chrome://extensions shows it).
param([string]$ExtensionId = 'cjgfablahgnphdahoageioncconbdjjn')

$ErrorActionPreference = 'Stop'
$name = 'com.kiku.youtube_to_score'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = (Get-Command python).Source
$utf8 = New-Object System.Text.UTF8Encoding($false)

# Chrome launches this; it runs the helper with this PC's Python.
$launcher = Join-Path $here 'yt_score_host.bat'
[IO.File]::WriteAllText($launcher, "@echo off`r`n`"$python`" `"%~dp0yt_score_host.py`" %*`r`n", [Text.Encoding]::ASCII)

$manifest = [ordered]@{
  name = $name
  description = 'YouTube to Score: fetches song audio with yt-dlp on this PC'
  path = $launcher
  type = 'stdio'
  allowed_origins = @("chrome-extension://$ExtensionId/")
}
$manifestPath = Join-Path $here "$name.json"
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json), $utf8)

$key = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$name"
New-Item -Path $key -Force | Out-Null
Set-Item -Path $key -Value $manifestPath

Write-Output "Registered $name for extension $ExtensionId"
Write-Output "Python:   $python"
Write-Output "Manifest: $manifestPath"
