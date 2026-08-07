param(
  [string]$NodeVersion = "22.23.2",
  [switch]$Force
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$packageJson = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $projectRoot "package.json") | ConvertFrom-Json
$baseName = "linggankanban-$($packageJson.version)-windows"
$portableName = "$baseName-portable-x64"
$distDir = Join-Path $projectRoot "dist"
$baseArchive = Join-Path $distDir "$baseName.zip"
$portableArchive = Join-Path $distDir "$portableName.zip"
$cacheDir = Join-Path $distDir ".runtime-cache"
$nodeFileName = "node-v$NodeVersion-win-x64.zip"
$nodeArchive = Join-Path $cacheDir $nodeFileName
$nodeUrl = "https://nodejs.org/dist/v$NodeVersion/$nodeFileName"
$sumsUrl = "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt"
$tempBase = [IO.Path]::GetTempPath()
$tempRoot = Join-Path $tempBase ("linggan-portable-" + [guid]::NewGuid().ToString("N"))
$extractRoot = Join-Path $tempRoot "release"
$nodeExtractRoot = Join-Path $tempRoot "node"

if ((Test-Path -LiteralPath $portableArchive) -and -not $Force) {
  throw "Portable archive already exists: $portableArchive. Use -Force to overwrite it."
}

try {
  New-Item -ItemType Directory -Force -Path $distDir, $cacheDir, $extractRoot, $nodeExtractRoot | Out-Null

  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "build-release.ps1") -Force
  if ($LASTEXITCODE -ne 0) { throw "Base release build failed." }

  $sums = (Invoke-WebRequest -UseBasicParsing -Uri $sumsUrl).Content
  $escapedName = [regex]::Escape($nodeFileName)
  $sumMatch = [regex]::Match($sums, "(?m)^([a-fA-F0-9]{64})\s+$escapedName$")
  if (-not $sumMatch.Success) { throw "Official SHA-256 was not found for $nodeFileName." }
  $expectedHash = $sumMatch.Groups[1].Value.ToUpperInvariant()

  $downloadRequired = $true
  if (Test-Path -LiteralPath $nodeArchive) {
    $cachedHash = (Get-FileHash -LiteralPath $nodeArchive -Algorithm SHA256).Hash.ToUpperInvariant()
    $downloadRequired = $cachedHash -ne $expectedHash
  }
  if ($downloadRequired) {
    Invoke-WebRequest -UseBasicParsing -Uri $nodeUrl -OutFile $nodeArchive
  }
  $actualHash = (Get-FileHash -LiteralPath $nodeArchive -Algorithm SHA256).Hash.ToUpperInvariant()
  if ($actualHash -ne $expectedHash) { throw "Node.js runtime checksum verification failed." }

  Expand-Archive -LiteralPath $baseArchive -DestinationPath $extractRoot
  $baseDir = Get-ChildItem -LiteralPath $extractRoot -Directory | Select-Object -First 1
  if (-not $baseDir) { throw "Base release archive has no root directory." }
  $stageDir = Join-Path $extractRoot $portableName
  Move-Item -LiteralPath $baseDir.FullName -Destination $stageDir

  npm ci --omit=dev --ignore-scripts --prefix $stageDir
  if ($LASTEXITCODE -ne 0) { throw "Production dependency installation failed." }

  Expand-Archive -LiteralPath $nodeArchive -DestinationPath $nodeExtractRoot
  $nodeDist = Get-ChildItem -LiteralPath $nodeExtractRoot -Directory | Select-Object -First 1
  if (-not $nodeDist) { throw "Official Node.js archive has no root directory." }
  $runtimeDir = Join-Path $stageDir "runtime"
  New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
  Copy-Item -LiteralPath (Join-Path $nodeDist.FullName "node.exe") -Destination (Join-Path $runtimeDir "node.exe")
  Copy-Item -LiteralPath (Join-Path $nodeDist.FullName "LICENSE") -Destination (Join-Path $runtimeDir "NODE-LICENSE.txt")
  Copy-Item -LiteralPath (Join-Path $projectRoot "start-portable.bat") -Destination (Join-Path $stageDir "start-portable.bat")

  $runtimeNotice = @(
    "Bundled runtime: Node.js v$NodeVersion (Windows x64)",
    "Official source: $nodeUrl",
    "SHA-256: $actualHash",
    "License: runtime/NODE-LICENSE.txt"
  ) -join [Environment]::NewLine
  Set-Content -Encoding UTF8 -LiteralPath (Join-Path $runtimeDir "RUNTIME-NOTICE.txt") -Value $runtimeNotice

  if (Test-Path -LiteralPath $portableArchive) { Remove-Item -LiteralPath $portableArchive }
  Compress-Archive -LiteralPath $stageDir -DestinationPath $portableArchive -CompressionLevel Optimal
  Write-Host "Portable archive created: $portableArchive"
  Write-Host "Node.js runtime SHA-256: $actualHash"
} finally {
  if ((Test-Path -LiteralPath $tempRoot) -and $tempRoot.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
