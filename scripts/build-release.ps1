param(
  [string]$OutputDirectory = "",
  [string]$ProjectRoot = "",
  [switch]$DryRun,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = if ($ProjectRoot) {
  [IO.Path]::GetFullPath($ProjectRoot)
} else {
  (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}
$packagePath = Join-Path $projectRoot "package.json"
$allowlistPath = Join-Path $projectRoot "scripts\release-allowlist.txt"
if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) { throw "package.json is missing." }
if (-not (Test-Path -LiteralPath $allowlistPath -PathType Leaf)) { throw "Release allowlist is missing." }

$packageJson = Get-Content -Raw -Encoding UTF8 -LiteralPath $packagePath | ConvertFrom-Json
if ([string]$packageJson.version -notmatch '^\d+\.\d+\.\d+$') { throw "package.json has an invalid release version." }
$packageName = "linggankanban-$($packageJson.version)-windows"
$distDir = if ($OutputDirectory) { [IO.Path]::GetFullPath($OutputDirectory) } else { Join-Path $projectRoot "dist" }
$archivePath = Join-Path $distDir "$packageName.zip"
$manifestPath = Join-Path $distDir "$packageName.manifest.json"
$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$tempRoot = [IO.Path]::GetFullPath((Join-Path $tempBase ("linggan-release-" + [guid]::NewGuid().ToString("N"))))
$stageDir = Join-Path $tempRoot $packageName
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Normalize-ReleasePath {
  param([string]$Value)
  $path = $Value.Trim()
  if (-not $path -or $path.Contains("\") -or [IO.Path]::IsPathRooted($path) -or
      $path -match '(^|/)\.\.?(/|$)' -or $path -match '[:?"<>|]' -or $path.Contains("//") -or
      ($path.Contains("*") -and ($path -notmatch '^[^*]+/\*\*$'))) {
    throw "Invalid release allowlist path: $Value"
  }
  return $path
}

function Assert-SafeReleasePath {
  param([string]$RelativePath)
  $path = $RelativePath.Replace("\", "/")
  $leaf = [IO.Path]::GetFileName($path)
  $cookieData = $path -notmatch '(^|/)node_modules(/|$)' -and $leaf -match '^(cookies?(\.(txt|json|env))?|\.cookies)$'
  if ($leaf -eq "DATA.md" -or $leaf -match '^DATA\.(backup|bak|old)-' -or
      $path -match '(^|/)\.linggan(/|$)' -or $path -match '(^|/)docs/entries(/|$)' -or
      $path -match '(^|/)docs/video(/|$)' -or $path -match '(^|/)promo-video(/|$)' -or
      $path -match '(^|/)archive-jobs[^/]*$' -or $leaf -eq ".env" -or
      $leaf -match '\.(mp4|mov|avi|webm)$' -or $leaf -match '\.(zip|7z|rar)$' -or
      $leaf -match '\.(log|pem|pfx|p12|key)$' -or $cookieData) {
    throw "Forbidden release path: $path"
  }
}

function Read-ReleaseAllowlist {
  $source = New-Object System.Collections.Generic.List[string]
  $portable = New-Object System.Collections.Generic.List[string]
  $seen = @{}
  foreach ($raw in Get-Content -Encoding UTF8 -LiteralPath $allowlistPath) {
    $line = $raw.Trim()
    if (-not $line -or $line.StartsWith("#")) { continue }
    if ($line -notmatch '^(source|portable)\s+(.+)$') { throw "Invalid release allowlist entry: $line" }
    $kind = $Matches[1]
    $relative = Normalize-ReleasePath $Matches[2]
    $key = "$kind`:$relative"
    if ($seen.ContainsKey($key)) { throw "Duplicate release allowlist entry: $line" }
    $seen[$key] = $true
    Assert-SafeReleasePath $relative
    if ($kind -eq "source") {
      if ($relative.Contains("*")) { throw "Source allowlist entries must be exact files: $relative" }
      $source.Add($relative)
    } else {
      $portable.Add($relative)
    }
  }
  if (-not $source.Count) { throw "Release source allowlist is empty." }
  return [pscustomobject]@{
    Source = @($source | Sort-Object -CaseSensitive)
    Portable = @($portable | Sort-Object -CaseSensitive)
  }
}

function Resolve-RegularSourceFile {
  param([string]$RelativePath)
  $candidate = [IO.Path]::GetFullPath((Join-Path $projectRoot $RelativePath.Replace("/", [IO.Path]::DirectorySeparatorChar)))
  $rootPrefix = $projectRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if (-not $candidate.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Release input escaped the project root: $RelativePath"
  }
  $cursor = $projectRoot
  foreach ($segment in $RelativePath.Split("/")) {
    $cursor = Join-Path $cursor $segment
    if (-not (Test-Path -LiteralPath $cursor)) { throw "Required release file is missing: $RelativePath" }
    $item = Get-Item -Force -LiteralPath $cursor
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Linked release input is forbidden: $RelativePath"
    }
  }
  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { throw "Release input is not a regular file: $RelativePath" }
  return $candidate
}

function Assert-NoSecretContent {
  param([string]$FilePath, [string]$RelativePath)
  $textExtensions = @(".bat", ".css", ".env", ".html", ".js", ".json", ".md", ".ps1", ".txt", ".yml", ".yaml", ".gyp")
  if ($textExtensions -notcontains [IO.Path]::GetExtension($FilePath).ToLowerInvariant()) { return }
  $text = Get-Content -Raw -Encoding UTF8 -LiteralPath $FilePath
  $patterns = @(
    'T5_SENTINEL_SECRET',
    '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----',
    '(?im)^\s*(LINGGAN_API_TOKEN|WECOM_SECRET|WECOM_CORP_SECRET|DINGTALK_CLIENT_SECRET|GITHUB_TOKEN|GH_TOKEN)\s*=\s*["'']?[A-Za-z0-9_+./=-]{8,}'
  )
  foreach ($pattern in $patterns) {
    if ($text -match $pattern) { throw "Secret-like content detected in release input: $RelativePath" }
  }
}

function Get-StageFiles {
  param([string]$Root)
  return @(Get-ChildItem -LiteralPath $Root -Recurse -File | Sort-Object { $_.FullName.Substring($Root.Length + 1).Replace("\", "/") })
}

function Get-Sha256 {
  param([string]$Path)
  $stream = [IO.File]::OpenRead($Path)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return (($algorithm.ComputeHash($stream) | ForEach-Object { $_.ToString("x2") }) -join "") }
  finally { $algorithm.Dispose(); $stream.Dispose() }
}

function Get-FileManifest {
  param([string]$Root)
  return @(Get-StageFiles $Root | ForEach-Object {
    $relative = $_.FullName.Substring($Root.Length + 1).Replace("\", "/")
    [ordered]@{
      path = $relative
      size = $_.Length
      sha256 = Get-Sha256 $_.FullName
    }
  })
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
      foreach ($file in Get-StageFiles $SourceDirectory) {
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

$contract = Read-ReleaseAllowlist
$existingOutputs = @($archivePath, $manifestPath) | Where-Object { Test-Path -LiteralPath $_ }
if ($existingOutputs -and -not $DryRun) {
  throw "Release output already exists: $($existingOutputs -join ', '). Choose a new -OutputDirectory."
}

try {
  New-Item -ItemType Directory -Path $stageDir -Force | Out-Null
  foreach ($relative in $contract.Source) {
    $source = Resolve-RegularSourceFile $relative
    Assert-NoSecretContent $source $relative
    $target = Join-Path $stageDir $relative.Replace("/", [IO.Path]::DirectorySeparatorChar)
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    [IO.File]::Copy($source, $target, $false)
  }

  $actual = @(Get-StageFiles $stageDir | ForEach-Object { $_.FullName.Substring($stageDir.Length + 1).Replace("\", "/") })
  if (($actual -join "`n") -cne ($contract.Source -join "`n")) {
    throw "Release staging manifest does not exactly match scripts/release-allowlist.txt."
  }

  $files = Get-FileManifest $stageDir
  $allowlistHash = Get-Sha256 $allowlistPath
  $manifest = [ordered]@{
    schemaVersion = 1
    package = $packageName
    sourceDateEpoch = 315532800
    allowlistSha256 = $allowlistHash
    files = $files
  }
  $manifestJson = ($manifest | ConvertTo-Json -Depth 5) + "`n"

  if ($DryRun) {
    Write-Host "Release dry-run passed: $($files.Count) allowlisted files"
  } else {
    New-Item -ItemType Directory -Path $distDir -Force | Out-Null
    [IO.File]::WriteAllText($manifestPath, $manifestJson, $utf8NoBom)
    Write-DeterministicZip $stageDir $archivePath $packageName
    Write-Host "Release archive created: $archivePath"
    Write-Host "Release manifest created: $manifestPath"
  }
} finally {
  $safePrefix = $tempBase.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if ((Test-Path -LiteralPath $tempRoot) -and $tempRoot.StartsWith($safePrefix, [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
