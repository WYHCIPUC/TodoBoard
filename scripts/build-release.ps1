param(
  [string]$OutputDirectory = "",
  [switch]$DryRun,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$packageJson = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $projectRoot "package.json") | ConvertFrom-Json
$packageName = "linggankanban-$($packageJson.version)-windows"
$distDir = if ($OutputDirectory) { [IO.Path]::GetFullPath($OutputDirectory) } else { Join-Path $projectRoot "dist" }
$archivePath = Join-Path $distDir "$packageName.zip"
$tempBase = [System.IO.Path]::GetTempPath()
$tempRoot = Join-Path $tempBase ("linggan-release-" + [guid]::NewGuid().ToString("N"))
$stageDir = Join-Path $tempRoot $packageName

# -Force is retained for caller compatibility, but release artifacts are never
# overwritten. Use a new OutputDirectory for every verification/build.
if (Test-Path -LiteralPath $archivePath) {
  throw "Release archive already exists: $archivePath. Choose a new -OutputDirectory."
}

function Copy-ReleaseTree {
  param([string]$Name)

  $sourceRoot = Join-Path $projectRoot $Name
  if (-not (Test-Path -LiteralPath $sourceRoot)) { return }

  Get-ChildItem -LiteralPath $sourceRoot -Recurse -File | ForEach-Object {
    $relative = $_.FullName.Substring($projectRoot.Length + 1)
    $normalized = $relative.Replace([System.IO.Path]::DirectorySeparatorChar, "/")
    $cookieData = $normalized -notmatch "(^|/)node_modules(/|$)" -and
      $normalized -match "(^|/)(cookies?(\.(txt|json|env))?|\.cookies)$"
    if ($normalized -match "(^|/)\.linggan(/|$)" -or $normalized -match "(^|/)DATA\.md$" -or
        $normalized -match "(^|/)docs/entries(/|$)" -or $normalized -match "(^|/)docs/video(/|$)" -or
        $normalized -match "(^|/)promo-video(/|$)" -or $normalized -match "(^|/)todoboard-promo-bgm\.mp4$" -or
        $cookieData -or $_.Extension -eq ".log" -or
        $normalized -eq "docs/fetch-log.md") { return }

    $target = Join-Path $stageDir $relative
    New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
    Copy-Item -LiteralPath $_.FullName -Destination $target
  }
}

function Copy-ReleaseDocs {
  $docsRoot = Join-Path $projectRoot "docs"
  if (-not (Test-Path -LiteralPath $docsRoot)) { return }
  # Do not recurse through docs/: docs/video/* is user-owned and must not even
  # be enumerated. The release documentation lives at these two known levels.
  foreach ($sourceRoot in @($docsRoot, (Join-Path $docsRoot "plans"))) {
    if (-not (Test-Path -LiteralPath $sourceRoot)) { continue }
    Get-ChildItem -LiteralPath $sourceRoot -File | ForEach-Object {
      $relative = $_.FullName.Substring($projectRoot.Length + 1)
      $normalized = $relative.Replace([System.IO.Path]::DirectorySeparatorChar, "/")
      if ($normalized -eq "docs/fetch-log.md" -or $_.Extension -eq ".log") { return }
      $target = Join-Path $stageDir $relative
      New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
      Copy-Item -LiteralPath $_.FullName -Destination $target
    }
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

  # These are the only source trees that belong in a release. In particular,
  # unrelated root-level untracked assets are never discovered by this list.
  foreach ($directory in @("assets/readme", "lib", "scripts")) { Copy-ReleaseTree $directory }
  Copy-ReleaseDocs

  $forbidden = Get-ChildItem -LiteralPath $stageDir -Recurse -File | Where-Object {
    $relative = $_.FullName.Substring($stageDir.Length + 1)
    $normalized = $relative.Replace([System.IO.Path]::DirectorySeparatorChar, "/")
    $cookieData = $normalized -notmatch "(^|/)node_modules(/|$)" -and
      $normalized -match "(^|/)(cookies?(\.(txt|json|env))?|\.cookies)$"
    $_.Name -eq "DATA.md" -or $_.Name -eq "fetch-log.md" -or $normalized -match "(^|/)docs/entries(/|$)" -or
    $normalized -match "(^|/)docs/video(/|$)" -or $normalized -match "(^|/)promo-video(/|$)" -or
    $_.Extension -eq ".log" -or $cookieData
  }
  if ($forbidden) {
    throw "Release staging contains user data, secrets, or logs: $($forbidden.FullName -join ', ')"
  }

  if ($DryRun) {
    Write-Host "Release dry-run passed: $stageDir"
  } else {
    New-Item -ItemType Directory -Force -Path $distDir | Out-Null
    if (Test-Path -LiteralPath $archivePath) { throw "Refusing to overwrite release archive: $archivePath" }
    Compress-Archive -LiteralPath $stageDir -DestinationPath $archivePath -CompressionLevel Optimal
    Write-Host "Release archive created: $archivePath"
  }
} finally {
  if ((Test-Path -LiteralPath $tempRoot) -and $tempRoot.StartsWith($tempBase, [System.StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
