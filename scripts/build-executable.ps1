param(
  [string]$NodeVersion = "22.23.2",
  [string]$OutputDirectory = "",
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$packageJson = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $projectRoot "package.json") | ConvertFrom-Json
$version = $packageJson.version
$portableName = "linggankanban-$version-windows-portable-x64"
$distDir = if ($OutputDirectory) { [IO.Path]::GetFullPath($OutputDirectory) } else { Join-Path $projectRoot "dist" }
$portableArchive = Join-Path $distDir "$portableName.zip"
$baseArchive = Join-Path $distDir "linggankanban-$version-windows.zip"
$executablePath = Join-Path $distDir "linggankanban-$version-windows-x64.exe"
$checksumPath = Join-Path $distDir "SHA256SUMS.txt"
$launcherDir = Join-Path $projectRoot "launcher"
$payloadPath = Join-Path $launcherDir "Payload.zip"
$publishDir = Join-Path ([IO.Path]::GetTempPath()) ("linggan-exe-" + [guid]::NewGuid().ToString("N"))

if ((Test-Path -LiteralPath $executablePath) -and -not $Force) {
  throw "Executable already exists: $executablePath. Use -Force to overwrite it."
}

try {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "build-portable.ps1") `
    -NodeVersion $NodeVersion `
    -OutputDirectory $distDir `
    -Force
  if ($LASTEXITCODE -ne 0) { throw "Portable package build failed." }
  if (-not (Test-Path -LiteralPath $portableArchive)) { throw "Portable archive is missing: $portableArchive" }

  Copy-Item -LiteralPath $portableArchive -Destination $payloadPath -Force
  New-Item -ItemType Directory -Force -Path $publishDir | Out-Null
  dotnet publish (Join-Path $launcherDir "LingganLauncher.csproj") `
    -c Release `
    -r win-x64 `
    --self-contained true `
    -p:Version=$version `
    -p:InformationalVersion=$version `
    -o $publishDir
  if ($LASTEXITCODE -ne 0) { throw "Single-file launcher compilation failed." }

  $builtExecutable = Join-Path $publishDir "LingganKanban.exe"
  if (-not (Test-Path -LiteralPath $builtExecutable)) { throw "Compiled executable is missing: $builtExecutable" }
  New-Item -ItemType Directory -Force -Path $distDir | Out-Null
  Copy-Item -LiteralPath $builtExecutable -Destination $executablePath -Force
  $hash = (Get-FileHash -LiteralPath $executablePath -Algorithm SHA256).Hash
  $portableHash = (Get-FileHash -LiteralPath $portableArchive -Algorithm SHA256).Hash
  $baseHash = (Get-FileHash -LiteralPath $baseArchive -Algorithm SHA256).Hash
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllLines($checksumPath, @(
    "$hash  $([IO.Path]::GetFileName($executablePath))",
    "$portableHash  $([IO.Path]::GetFileName($portableArchive))",
    "$baseHash  $([IO.Path]::GetFileName($baseArchive))"
  ), $utf8NoBom)
  Write-Host "Single-file executable created: $executablePath"
  Write-Host "SHA-256: $hash"
  Write-Host "Checksums created: $checksumPath"
} finally {
  if (Test-Path -LiteralPath $payloadPath) { Remove-Item -LiteralPath $payloadPath -Force }
  if ((Test-Path -LiteralPath $publishDir) -and $publishDir.StartsWith([IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $publishDir -Recurse -Force
  }
}
