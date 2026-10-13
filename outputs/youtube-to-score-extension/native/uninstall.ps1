# Removes the yt-dlp helper's registration from Chrome for this Windows user.
$name = 'com.kiku.youtube_to_score'
Remove-Item -Path "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$name" -Force -ErrorAction SilentlyContinue
Write-Output "Removed $name"
