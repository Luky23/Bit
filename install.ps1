[CmdletBinding()]
param([string]$Version = "")

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

Write-Host @"
====================================================
===       INSTALANDO BIT ASISTENTE LOCAL         ===
====================================================
"@ -ForegroundColor Cyan

$repository = "Luky23/Bit"
$installDir = Join-Path $env:LOCALAPPDATA "Bit"
$temporaryDir = Join-Path ([IO.Path]::GetTempPath()) ("Bit-install-" + [guid]::NewGuid().ToString("N"))

function Assert-GitHubUrl([uri]$Uri) {
  if ($Uri.Scheme -ne "https" -or $Uri.Host -ne "github.com" -or $Uri.UserInfo) {
    throw "URL rechazada: las descargas del instalador solo pueden usar https://github.com/"
  }
}

try {
  if (-not $Version) {
    $latest = [uri]"https://github.com/$repository/releases/latest"
    Assert-GitHubUrl $latest
    $request = [Net.HttpWebRequest]::Create($latest)
    $request.AllowAutoRedirect = $true
    $request.Method = "HEAD"
    $response = $request.GetResponse()
    try { $Version = $response.ResponseUri.Segments[-1].TrimEnd("/") } finally { $response.Dispose() }
  }
  if ($Version -notmatch '^v[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$') { throw "Versión inválida: $Version" }

  $base = [uri]"https://github.com/$repository/releases/download/$Version/"
  $binaryUrl = [uri]::new($base, "Bit-Portable.exe")
  $hashUrl = [uri]::new($base, "Bit-Portable.exe.sha256")
  Assert-GitHubUrl $binaryUrl
  Assert-GitHubUrl $hashUrl

  New-Item -ItemType Directory -Path $temporaryDir | Out-Null
  $downloadedBinary = Join-Path $temporaryDir "Bit-Portable.exe"
  $downloadedHash = Join-Path $temporaryDir "Bit-Portable.exe.sha256"
  $client = [Net.WebClient]::new()
  try {
    $client.DownloadFile($binaryUrl, $downloadedBinary)
    $client.DownloadFile($hashUrl, $downloadedHash)
  } finally { $client.Dispose() }

  $hashLine = (Get-Content -LiteralPath $downloadedHash -Raw).Trim()
  if ($hashLine -notmatch '^([a-fA-F0-9]{64})\s+\*?Bit-Portable\.exe$') { throw "El archivo SHA256 publicado tiene un formato inválido" }
  $expected = $Matches[1].ToLowerInvariant()
  $actual = (Get-FileHash -LiteralPath $downloadedBinary -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw "SHA256 inválido. La descarga fue descartada." }

  Get-Process -Name "Bit","Bit-Portable" -ErrorAction SilentlyContinue | Stop-Process -Force
  New-Item -ItemType Directory -Path $installDir -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $installDir "data\models") -Force | Out-Null
  New-Item -ItemType File -Path (Join-Path $installDir "portable.flag") -Force | Out-Null
  $installedBinary = Join-Path $installDir "Bit.exe"
  Move-Item -LiteralPath $downloadedBinary -Destination $installedBinary -Force

  $shell = New-Object -ComObject WScript.Shell
  foreach ($shortcutPath in @(
    (Join-Path ([Environment]::GetFolderPath("Desktop")) "Bit.lnk"),
    (Join-Path ([Environment]::GetFolderPath("StartMenu")) "Programs\Bit.lnk")
  )) {
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $installedBinary
    $shortcut.WorkingDirectory = $installDir
    $shortcut.Save()
  }

  Start-Process -FilePath $installedBinary -WorkingDirectory $installDir
  Write-Host "Bit $Version fue instalado y verificado en $installDir" -ForegroundColor Green
} finally {
  if (Test-Path -LiteralPath $temporaryDir) { Remove-Item -LiteralPath $temporaryDir -Recurse -Force }
}
