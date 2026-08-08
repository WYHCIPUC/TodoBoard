param(
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$packageJson = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $projectRoot "package.json") | ConvertFrom-Json
$packageName = "linggankanban-$($packageJson.version)-windows"
$distDir = Join-Path $projectRoot "dist"
$archivePath = Join-Path $distDir "$packageName.zip"
$tempBase = [System.IO.Path]::GetTempPath()
$tempRoot = Join-Path $tempBase ("linggan-release-" + [guid]::NewGuid().ToString("N"))
$stageDir = Join-Path $tempRoot $packageName

if ((Test-Path -LiteralPath $archivePath) -and -not $Force) {
  throw "Release archive already exists: $archivePath. Use -Force to overwrite it."
}

function Copy-ReleaseTree {
  param([string]$Name)

  $sourceRoot = Join-Path $projectRoot $Name
  if (-not (Test-Path -LiteralPath $sourceRoot)) { return }

  Get-ChildItem -LiteralPath $sourceRoot -Recurse -File | ForEach-Object {
    $relative = $_.FullName.Substring($projectRoot.Length + 1)
    $normalized = $relative.Replace([System.IO.Path]::DirectorySeparatorChar, "/")
    if ($normalized -like "docs/entries/*") { return }
    if ($normalized -like "docs/video/*") { return }
    if ($normalized -like "docs/*.log") { return }
    if ($normalized -eq "docs/fetch-log.md") { return }
    if ($normalized -match "(^|/)\.linggan(/|$)") { return }

    $target = Join-Path $stageDir $relative
    New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
    Copy-Item -LiteralPath $_.FullName -Destination $target
  }
}

try {
  New-Item -ItemType Directory -Force -Path $stageDir | Out-Null

  $topLevelFiles = @(
    ".nvmrc",
    "board.css",
    "board.html",
    "board.js",
    "CHANGELOG.md",
    "CONTRIBUTING.md",
    "DATA.example.md",
    "guard.js",
    "LICENSE",
    "package-lock.json",
    "package.json",
    "README.md",
    "SECURITY.md",
    "server.js",
    "start.bat"
  )

  foreach ($file in $topLevelFiles) {
    $source = Join-Path $projectRoot $file
    if (-not (Test-Path -LiteralPath $source)) { throw "Required release file is missing: $file" }
    Copy-Item -LiteralPath $source -Destination (Join-Path $stageDir $file)
  }

  foreach ($directory in @("assets", "docs", "lib", "scripts")) {
    Copy-ReleaseTree $directory
  }

  $forbidden = Get-ChildItem -LiteralPath $stageDir -Recurse -File | Where-Object {
    $_.Name -eq "DATA.md" -or $_.Name -eq "fetch-log.md" -or $_.FullName -match "[\\/]docs[\\/]entries[\\/]" -or $_.Extension -eq ".log"
  }
  if ($forbidden) {
    throw "Release archive contains user data or logs: $($forbidden.FullName -join ', ')"
  }

  New-Item -ItemType Directory -Force -Path $distDir | Out-Null
  if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath }
  Compress-Archive -LiteralPath $stageDir -DestinationPath $archivePath -CompressionLevel Optimal
  Write-Host "Release archive created: $archivePath"
} finally {
  if ((Test-Path -LiteralPath $tempRoot) -and $tempRoot.StartsWith($tempBase, [System.StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
