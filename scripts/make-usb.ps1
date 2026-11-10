param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z]:$')]
  [string]$Drive
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$driveRoot = "$Drive\"
$driveInfo = [System.IO.DriveInfo]::new($driveRoot)
if (-not $driveInfo.IsReady) { throw "La unidad $Drive no está disponible." }
if ($driveInfo.DriveType -ne [System.IO.DriveType]::Removable -and $driveInfo.DriveType -ne [System.IO.DriveType]::Fixed) {
  throw "La unidad $Drive no es una unidad de almacenamiento local."
}
if ($driveInfo.DriveFormat -eq 'FAT32') {
  Write-Warning 'FAT32 limita cada archivo a 4 GB. Se recomienda exFAT o NTFS para modelos GGUF.'
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$source = Join-Path $repoRoot 'dist\win-unpacked'
$destination = Join-Path $driveRoot 'Bit'
if (Test-Path -LiteralPath $destination) {
  throw "Ya existe $destination. Para evitar sobreescrituras, elija una unidad sin la carpeta Bit o respáldela y retírela manualmente."
}

Push-Location $repoRoot
try {
  & npm.cmd run dist:dir
  if ($LASTEXITCODE -ne 0) { throw "Falló la compilación de Bit (código $LASTEXITCODE)." }
} finally {
  Pop-Location
}

$executable = Join-Path $source 'Bit.exe'
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
  throw "No se generó $executable. Revise la configuración de electron-builder."
}

$buildBytes = (Get-ChildItem -LiteralPath $source -File -Recurse | Measure-Object -Property Length -Sum).Sum
if ($driveInfo.AvailableFreeSpace -lt $buildBytes) {
  throw "La unidad $Drive no tiene espacio suficiente para el build ($buildBytes bytes)."
}

New-Item -ItemType Directory -Path $destination -ErrorAction Stop | Out-Null
Get-ChildItem -LiteralPath $source | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $destination -Recurse -Force -ErrorAction Stop
}
New-Item -ItemType File -Path (Join-Path $destination 'portable.flag') -ErrorAction Stop | Out-Null
New-Item -ItemType Directory -Path (Join-Path $destination 'data\models') -Force -ErrorAction Stop | Out-Null

Write-Host "Bit listo en $destination. Abra Bit.exe con doble clic."
Write-Host 'Copie sus modelos GGUF revisados a data\models antes de conversar con Bit.'
