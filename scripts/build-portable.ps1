param(
  [string]$OutputDirectory = "",
  [string]$ProjectRoot = "",
  [string]$RuntimeArchive = "",
  [string]$NodeVersion = "",
  [switch]$DryRun,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$projectRoot = if ($ProjectRoot) { [IO.Path]::GetFullPath($ProjectRoot) } else { (Resolve-Path (Join-Path $PSScriptRoot "..")).Path }
$packageJson = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $projectRoot "package.json") | ConvertFrom-Json
$runtimeConfigPath = Join-Path $projectRoot "scripts\runtime-node.json"
$allowlistPath = Join-Path $projectRoot "scripts\release-allowlist.txt"
if (-not (Test-Path -LiteralPath $runtimeConfigPath -PathType Leaf)) { throw "Pinned runtime configuration is missing." }
$runtime = Get-Content -Raw -Encoding UTF8 -LiteralPath $runtimeConfigPath | ConvertFrom-Json

foreach ($field in @("version", "platform", "archive", "url", "sha256", "nodeExecutableSha256")) {
  if (-not ($runtime.PSObject.Properties.Name -contains $field) -or -not [string]$runtime.$field) {
    throw "Pinned runtime configuration is missing '$field'."
  }
}
if ($runtime.version -notmatch '^24\.\d+\.\d+$' -or $runtime.platform -ne "win-x64") { throw "Packaged runtime must be an exact Node.js 24 win-x64 release." }
if ($NodeVersion -and $NodeVersion -ne $runtime.version) { throw "-NodeVersion cannot override scripts/runtime-node.json." }
$expectedArchive = "node-v$($runtime.version)-win-x64.zip"
$expectedUrl = "https://nodejs.org/dist/v$($runtime.version)/$expectedArchive"
if ($runtime.archive -ne $expectedArchive -or $runtime.url -ne $expectedUrl) { throw "Pinned runtime archive or URL is inconsistent with its version." }
if ($runtime.sha256 -notmatch '^[a-f0-9]{64}$' -or $runtime.nodeExecutableSha256 -notmatch '^[a-f0-9]{64}$') { throw "Pinned runtime SHA-256 values are invalid." }

$baseName = "linggankanban-$($packageJson.version)-windows"
$portableName = "$baseName-portable-x64"
$distDir = if ($OutputDirectory) { [IO.Path]::GetFullPath($OutputDirectory) } else { Join-Path $projectRoot "dist" }
$baseArchive = Join-Path $distDir "$baseName.zip"
$baseManifest = Join-Path $distDir "$baseName.manifest.json"
$portableArchive = Join-Path $distDir "$portableName.zip"
$portableManifest = Join-Path $distDir "$portableName.manifest.json"
$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$tempRoot = [IO.Path]::GetFullPath((Join-Path $tempBase ("linggan-portable-" + [guid]::NewGuid().ToString("N"))))
$baseBuildDir = Join-Path $tempRoot "base-output"
$extractRoot = Join-Path $tempRoot "release"
$runtimeExtractRoot = Join-Path $tempRoot "runtime"
$downloadedRuntime = Join-Path $tempRoot $runtime.archive
$stageDir = Join-Path $extractRoot $portableName
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Get-Hash([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return (($algorithm.ComputeHash($stream) | ForEach-Object { $_.ToString("x2") }) -join "") }
  finally { $algorithm.Dispose(); $stream.Dispose() }
}

function Get-Files([string]$Root) {
  return @(Get-ChildItem -LiteralPath $Root -Recurse -File | Sort-Object { $_.FullName.Substring($Root.Length + 1).Replace("\", "/") })
}

function Assert-SafeArchive {
  param([string]$ArchivePath, [string]$ExpectedRoot)
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
  try {
    $seen = @{}
    foreach ($entry in $archive.Entries) {
      $name = $entry.FullName.Replace("\", "/")
      if (-not $name -or $name.StartsWith("/") -or $name -match '(^|/)\.\.?(/|$)' -or $name.Contains(":")) {
        throw "Archive contains an unsafe path: $name"
      }
      if (-not $name.StartsWith("$ExpectedRoot/", [StringComparison]::Ordinal)) { throw "Archive has an unexpected root: $name" }
      if ($seen.ContainsKey($name)) { throw "Archive contains a duplicate path: $name" }
      $seen[$name] = $true
      $unixMode = ($entry.ExternalAttributes -shr 16) -band 0xF000
      if ($unixMode -eq 0xA000) { throw "Archive contains a symbolic link: $name" }
    }
  } finally { $archive.Dispose() }
}

function Write-DeterministicZip {
  param([string]$SourceDirectory, [string]$DestinationPath, [string]$RootName)
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $stream = [IO.File]::Open($DestinationPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  try {
    $zip = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create, $false, [Text.Encoding]::UTF8)
    try {
      $fixedTime = [DateTimeOffset]::Parse("1980-01-01T00:00:00Z")
      foreach ($file in Get-Files $SourceDirectory) {
        $relative = $file.FullName.Substring($SourceDirectory.Length + 1).Replace("\", "/")
        $entry = $zip.CreateEntry("$RootName/$relative", [IO.Compression.CompressionLevel]::Optimal)
        $entry.LastWriteTime = $fixedTime
        $input = [IO.File]::OpenRead($file.FullName)
        $output = $entry.Open()
        try { $input.CopyTo($output) } finally { $output.Dispose(); $input.Dispose() }
      }
    } finally { $zip.Dispose() }
  } finally { $stream.Dispose() }
}

function Get-Allowlist {
  $source = New-Object System.Collections.Generic.List[string]
  $portable = New-Object System.Collections.Generic.List[string]
  foreach ($raw in Get-Content -Encoding UTF8 -LiteralPath $allowlistPath) {
    $line = $raw.Trim()
    if (-not $line -or $line.StartsWith("#")) { continue }
    if ($line -notmatch '^(source|portable)\s+(.+)$') { throw "Invalid release allowlist entry: $line" }
    $path = $Matches[2].Trim()
    if ($Matches[1] -eq "source") { $source.Add($path) } else { $portable.Add($path) }
  }
  return [pscustomobject]@{ Source = @($source); Portable = @($portable) }
}

function Test-PortablePathAllowed {
  param([string]$RelativePath, $Contract)
  if ($Contract.Source -ccontains $RelativePath) { return $true }
  foreach ($pattern in $Contract.Portable) {
    if ($pattern.EndsWith("/**")) {
      $prefix = $pattern.Substring(0, $pattern.Length - 2)
      if ($RelativePath.StartsWith($prefix, [StringComparison]::Ordinal)) { return $true }
    } elseif ($RelativePath -ceq $pattern) { return $true }
  }
  return $false
}

function Assert-PortableStage {
  param([string]$Root, $Contract)
  $required = @($Contract.Source) + @($Contract.Portable | Where-Object { -not $_.EndsWith("/**") })
  foreach ($relative in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $Root $relative.Replace("/", "\")) -PathType Leaf)) {
      throw "Portable staging is missing an allowlisted file: $relative"
    }
  }
  foreach ($item in Get-ChildItem -LiteralPath $Root -Recurse -Force) {
    $relative = $item.FullName.Substring($Root.Length + 1).Replace("\", "/")
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Portable staging contains a linked entry: $relative" }
    if ($item.PSIsContainer) { continue }
    if (-not (Test-PortablePathAllowed $relative $Contract)) { throw "Portable staging contains an unexpected file: $relative" }
    $leaf = [IO.Path]::GetFileName($relative)
    $cookieData = $relative -notmatch '(^|/)node_modules(/|$)' -and $leaf -match '^(cookies?(\.(txt|json|env))?|\.cookies)$'
    if ($leaf -eq "DATA.md" -or $relative -match '(^|/)\.linggan(/|$)' -or $relative -match '(^|/)docs/entries(/|$)' -or
        $relative -match '(^|/)docs/video(/|$)' -or $relative -match '(^|/)archive-jobs[^/]*$' -or
        $leaf -eq ".env" -or $leaf -match '\.(mp4|mov|avi|webm|log|pem|pfx|p12|key)$' -or $cookieData) {
      throw "Portable staging contains forbidden content: $relative"
    }
    $extension = [IO.Path]::GetExtension($relative).ToLowerInvariant()
    if (@(".bat", ".css", ".env", ".html", ".js", ".json", ".md", ".ps1", ".txt", ".yml", ".yaml", ".gyp") -contains $extension) {
      $text = Get-Content -Raw -Encoding UTF8 -LiteralPath $item.FullName
      if ($text -match 'T5_SENTINEL_SECRET|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----' -or
          $text -match '(?im)^\s*(LINGGAN_API_TOKEN|WECOM_SECRET|WECOM_CORP_SECRET|DINGTALK_CLIENT_SECRET|GITHUB_TOKEN|GH_TOKEN)\s*=\s*["'']?[A-Za-z0-9_+./=-]{8,}') {
        throw "Portable staging contains secret-like content: $relative"
      }
    }
  }
}

function Get-ManifestFiles([string]$Root) {
  return @(Get-Files $Root | ForEach-Object {
    [ordered]@{
      path = $_.FullName.Substring($Root.Length + 1).Replace("\", "/")
      size = $_.Length
      sha256 = Get-Hash $_.FullName
    }
  })
}

$contract = Get-Allowlist
if ($DryRun) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectRoot "scripts\build-release.ps1") -ProjectRoot $projectRoot -DryRun
  if ($LASTEXITCODE -ne 0) { throw "Base release dry-run failed." }
  Write-Host "Portable dry-run passed with pinned Node.js v$($runtime.version)."
  exit 0
}

if ((Test-Path -LiteralPath $portableArchive) -or (Test-Path -LiteralPath $portableManifest)) {
  throw "Portable output already exists. Choose a new -OutputDirectory."
}

try {
  New-Item -ItemType Directory -Path $baseBuildDir, $extractRoot, $runtimeExtractRoot -Force | Out-Null
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectRoot "scripts\build-release.ps1") -ProjectRoot $projectRoot -OutputDirectory $baseBuildDir
  if ($LASTEXITCODE -ne 0) { throw "Base release build failed." }
  $builtBaseArchive = Join-Path $baseBuildDir "$baseName.zip"
  $builtBaseManifest = Join-Path $baseBuildDir "$baseName.manifest.json"

  New-Item -ItemType Directory -Path $distDir -Force | Out-Null
  foreach ($pair in @(@($builtBaseArchive, $baseArchive), @($builtBaseManifest, $baseManifest))) {
    if (Test-Path -LiteralPath $pair[1]) {
      if ((Get-Hash $pair[0]) -ne (Get-Hash $pair[1])) { throw "Existing base release output does not match the deterministic build: $($pair[1])" }
    } else {
      [IO.File]::Copy($pair[0], $pair[1], $false)
    }
  }

  Assert-SafeArchive $builtBaseArchive $baseName
  Expand-Archive -LiteralPath $builtBaseArchive -DestinationPath $extractRoot
  $baseStage = Join-Path $extractRoot $baseName
  if (-not (Test-Path -LiteralPath $baseStage -PathType Container)) { throw "Base release archive has no expected root directory." }
  Move-Item -LiteralPath $baseStage -Destination $stageDir

  $runtimeArchivePath = if ($RuntimeArchive) { [IO.Path]::GetFullPath($RuntimeArchive) } elseif ($env:LINGGAN_NODE_RUNTIME_ARCHIVE) { [IO.Path]::GetFullPath($env:LINGGAN_NODE_RUNTIME_ARCHIVE) } else { $downloadedRuntime }
  if (-not $RuntimeArchive -and -not $env:LINGGAN_NODE_RUNTIME_ARCHIVE) {
    Invoke-WebRequest -UseBasicParsing -Uri $runtime.url -OutFile $runtimeArchivePath
  }
  if (-not (Test-Path -LiteralPath $runtimeArchivePath -PathType Leaf)) { throw "Pinned Node.js runtime archive is missing: $runtimeArchivePath" }
  if ((Get-Hash $runtimeArchivePath) -ne $runtime.sha256) { throw "Pinned Node.js runtime checksum verification failed." }

  $runtimeRootName = "node-v$($runtime.version)-win-x64"
  Assert-SafeArchive $runtimeArchivePath $runtimeRootName
  Expand-Archive -LiteralPath $runtimeArchivePath -DestinationPath $runtimeExtractRoot
  $nodeDist = Join-Path $runtimeExtractRoot $runtimeRootName
  $nodeExe = Join-Path $nodeDist "node.exe"
  $npmCmd = Join-Path $nodeDist "npm.cmd"
  if ((Get-Hash $nodeExe) -ne $runtime.nodeExecutableSha256) { throw "Extracted node.exe does not match scripts/runtime-node.json." }
  $reportedVersion = (& $nodeExe --version).Trim()
  if ($LASTEXITCODE -ne 0 -or $reportedVersion -ne "v$($runtime.version)") { throw "Extracted runtime reported an unexpected version: $reportedVersion" }

  $originalPath = $env:PATH
  $originalCl = $env:CL
  $originalLink = $env:LINK
  $originalLinkTail = $env:_LINK_
  $originalSourceDateEpoch = $env:SOURCE_DATE_EPOCH
  try {
    $env:PATH = $nodeDist + [IO.Path]::PathSeparator + $originalPath
    $env:CL = (([string]$originalCl).Trim() + " /Brepro").Trim()
    $env:LINK = (([string]$originalLink).Trim() + " /Brepro").Trim()
    $env:_LINK_ = (([string]$originalLinkTail).Trim() + " /Brepro /DEBUG:NONE").Trim()
    $env:SOURCE_DATE_EPOCH = "315532800"
    & $npmCmd ci --omit=dev --no-audit --no-fund --prefix $stageDir
    if ($LASTEXITCODE -ne 0) { throw "Production dependency installation or native lock build failed." }
  } finally {
    $env:PATH = $originalPath
    $env:CL = $originalCl
    $env:LINK = $originalLink
    $env:_LINK_ = $originalLinkTail
    $env:SOURCE_DATE_EPOCH = $originalSourceDateEpoch
  }
  $nativeBinding = Join-Path $stageDir "build\Release\volume_lock.node"
  if (-not (Test-Path -LiteralPath $nativeBinding -PathType Leaf)) { throw "Node.js 24 native volume lock binding was not built." }
  $nativeCopy = Join-Path $tempRoot "volume_lock.node"
  [IO.File]::Copy($nativeBinding, $nativeCopy, $false)
  $generatedBuild = Join-Path $stageDir "build"
  if (-not $generatedBuild.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "Generated native build path escaped the temporary root." }
  Remove-Item -LiteralPath $generatedBuild -Recurse -Force
  New-Item -ItemType Directory -Path (Join-Path $stageDir "build\Release") -Force | Out-Null
  [IO.File]::Copy($nativeCopy, $nativeBinding, $false)

  $runtimeDir = Join-Path $stageDir "runtime"
  New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
  [IO.File]::Copy($nodeExe, (Join-Path $runtimeDir "node.exe"), $false)
  [IO.File]::Copy((Join-Path $nodeDist "LICENSE"), (Join-Path $runtimeDir "NODE-LICENSE.txt"), $false)
  [IO.File]::Copy((Join-Path $projectRoot "start-portable.bat"), (Join-Path $stageDir "start-portable.bat"), $false)
  $notice = @(
    "Bundled runtime: Node.js v$($runtime.version) (Windows x64)",
    "Official source: $($runtime.url)",
    "Archive SHA-256: $($runtime.sha256)",
    "node.exe SHA-256: $($runtime.nodeExecutableSha256)",
    "License: runtime/NODE-LICENSE.txt"
  ) -join "`n"
  [IO.File]::WriteAllText((Join-Path $runtimeDir "RUNTIME-NOTICE.txt"), $notice + "`n", $utf8NoBom)

  Assert-PortableStage $stageDir $contract
  $files = Get-ManifestFiles $stageDir
  $manifest = [ordered]@{
    schemaVersion = 1
    package = $portableName
    sourceDateEpoch = 315532800
    allowlistSha256 = Get-Hash $allowlistPath
    runtime = [ordered]@{
      version = $runtime.version
      archiveSha256 = $runtime.sha256
      nodeExecutableSha256 = $runtime.nodeExecutableSha256
    }
    files = $files
  }
  [IO.File]::WriteAllText($portableManifest, (($manifest | ConvertTo-Json -Depth 6) + "`n"), $utf8NoBom)
  Write-DeterministicZip $stageDir $portableArchive $portableName
  Write-Host "Portable archive created: $portableArchive"
  Write-Host "Pinned runtime verified: Node.js v$($runtime.version)"
} finally {
  $safePrefix = $tempBase.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if ((Test-Path -LiteralPath $tempRoot) -and $tempRoot.StartsWith($safePrefix, [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
