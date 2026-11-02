# Installs (or updates) Pulse on Windows 10/11 — no admin rights needed.
#   irm https://raw.githubusercontent.com/jakubdidkovsky/pulse-browser/main/install.ps1 | iex
# Uninstall: Settings → Apps → Installed apps → Pulse → Uninstall.

& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest is many times faster without its progress bar
  # Windows PowerShell 5.1 on older Windows 10 doesn't offer TLS 1.2 by default; GitHub requires it.
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  $repo = if ($env:PULSE_REPO) { $env:PULSE_REPO } else { 'jakubdidkovsky/pulse-browser' }
  $base = if ($env:PULSE_DOWNLOAD_URL) { $env:PULSE_DOWNLOAD_URL } else { "https://github.com/$repo/releases/latest/download" }

  if (-not [Environment]::Is64BitOperatingSystem) {
    Write-Host 'Pulse needs 64-bit Windows.' -ForegroundColor Red
    return
  }
  $arm = $env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64'
  $arch = if ($arm) { 'arm64' } else { 'x64' }
  $name = "Pulse-Setup-$arch.exe"
  $setup = Join-Path $env:TEMP $name

  Write-Host "Downloading Pulse ($arch)..." -ForegroundColor Magenta
  try {
    Invoke-WebRequest -UseBasicParsing -Uri "$base/$name" -OutFile $setup
  } catch {
    Write-Host "Download failed. Is there a published release at https://github.com/$repo/releases ?" -ForegroundColor Red
    return
  }

  $sums = $null
  try {
    $sums = (Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS.txt").Content
    if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }
  } catch {
    Write-Host 'This release has no checksums; skipping verification.'
  }
  if ($sums) {
    $line = $sums -split "`n" | Where-Object { $_ -match "^[0-9a-f]{64}\s+\*?$([regex]::Escape($name))\s*$" } | Select-Object -First 1
    $actual = (Get-FileHash -Algorithm SHA256 $setup).Hash.ToLower()
    if (-not $line -or $actual -ne $line.Substring(0, 64)) {
      Remove-Item $setup -Force
      Write-Host 'The download is damaged (checksum mismatch). Please try again.' -ForegroundColor Red
      return
    }
  }

  Write-Host 'Installing...' -ForegroundColor Magenta
  # The installer copies Pulse to %LOCALAPPDATA%\Programs, adds Start menu and desktop shortcuts, then opens it.
  # Wait for the installer only (Start-Process -Wait would also wait for the Pulse window it opens).
  (Start-Process -FilePath $setup -PassThru).WaitForExit()
  Remove-Item $setup -Force -ErrorAction SilentlyContinue
  Write-Host 'Done! Pulse is in your Start menu and on the desktop.' -ForegroundColor Green
  Write-Host 'To use it as your default browser: Settings > Apps > Default apps > Pulse.'
}
