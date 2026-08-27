param(
  [string]$ReleaseDirectory = "",
  [string]$ComparisonDirectory = "",
  [string]$EvidencePath = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$packageJson = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $projectRoot "package.json") | ConvertFrom-Json
$runtime = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $projectRoot "scripts\runtime-node.json") | ConvertFrom-Json
$version = [string]$packageJson.version
$baseName = "linggankanban-$version-windows"
$portableName = "$baseName-portable-x64"
$releaseDir = if ($ReleaseDirectory) { [IO.Path]::GetFullPath($ReleaseDirectory) } else { Join-Path $projectRoot "dist" }
$checksumPath = Join-Path $releaseDir "SHA256SUMS.txt"
$assetNames = @(
  "$baseName.manifest.json",
  "$baseName.zip",
  "$portableName.manifest.json",
  "$portableName.zip",
  "linggankanban-$version-windows-x64.exe"
) | Sort-Object
$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$drillRoot = [IO.Path]::GetFullPath((Join-Path $tempBase ("linggan-release-drill-" + [guid]::NewGuid().ToString("N"))))
$safePrefix = $tempBase.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$serverProcess = $null

function Get-Hash([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return (($algorithm.ComputeHash($stream) | ForEach-Object { $_.ToString("x2") }) -join "") }
  finally { $algorithm.Dispose(); $stream.Dispose() }
}

function Assert-SafeZip {
  param([string]$ArchivePath, [string]$ExpectedRoot)
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
  try {
    $seen = @{}
    foreach ($entry in $archive.Entries) {
      $name = $entry.FullName.Replace("\", "/")
      if (-not $name -or $name.StartsWith("/") -or $name -match '(^|/)\.\.?(/|$)' -or $name.Contains(":")) { throw "Archive path traversal detected: $name" }
      if (-not $name.StartsWith("$ExpectedRoot/", [StringComparison]::Ordinal)) { throw "Unexpected archive root: $name" }
      if ($seen.ContainsKey($name)) { throw "Duplicate archive entry: $name" }
      $seen[$name] = $true
      if ((($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { throw "Archive symbolic link detected: $name" }
    }
  } finally { $archive.Dispose() }
}

function Get-Inventory([string]$Root) {
  return @(Get-ChildItem -LiteralPath $Root -Recurse -File | Sort-Object { $_.FullName.Substring($Root.Length + 1).Replace("\", "/") } | ForEach-Object {
    [pscustomobject]@{
      path = $_.FullName.Substring($Root.Length + 1).Replace("\", "/")
      size = [long]$_.Length
      sha256 = Get-Hash $_.FullName
    }
  })
}

function Assert-Manifest {
  param([string]$Root, [string]$ManifestPath)
  $manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $ManifestPath | ConvertFrom-Json
  $actual = Get-Inventory $Root
  if ($actual.Count -ne $manifest.files.Count) { throw "Fresh extraction file count does not match $ManifestPath." }
  $actualByPath = [Collections.Generic.Dictionary[string, object]]::new([StringComparer]::Ordinal)
  foreach ($item in $actual) {
    if (-not $actualByPath.TryAdd($item.path, $item)) { throw "Fresh extraction contains a duplicate path: $($item.path)." }
  }
  foreach ($expected in $manifest.files) {
    $item = $null
    if (-not $actualByPath.TryGetValue([string]$expected.path, [ref]$item) -or
        $item.size -ne [long]$expected.size -or $item.sha256 -ne $expected.sha256) {
      throw "Fresh extraction manifest mismatch at $($expected.path)."
    }
  }
  return $manifest
}

function Assert-NoForbiddenContent {
  param([string]$Root)
  foreach ($item in Get-ChildItem -LiteralPath $Root -Recurse -Force) {
    $relative = $item.FullName.Substring($Root.Length + 1).Replace("\", "/")
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Fresh extraction contains a linked entry: $relative" }
    if ($item.PSIsContainer) { continue }
    $leaf = [IO.Path]::GetFileName($relative)
    $cookieData = $relative -notmatch '(^|/)node_modules(/|$)' -and $leaf -match '^(cookies?(\.(txt|json|env))?|\.cookies)$'
    if ($leaf -eq "DATA.md" -or $leaf -match '^DATA\.(backup|bak|old)-' -or $relative -match '(^|/)\.linggan(/|$)' -or
        $relative -match '(^|/)docs/entries(/|$)' -or $relative -match '(^|/)docs/video(/|$)' -or
        $relative -match '(^|/)promo-video(/|$)' -or $relative -match '(^|/)archive-jobs[^/]*$' -or
        $leaf -eq ".env" -or $leaf -match '\.(mp4|mov|avi|webm|log|pem|pfx|p12|key)$' -or $cookieData) {
      throw "Forbidden content found in fresh extraction: $relative"
    }
    $extension = [IO.Path]::GetExtension($relative).ToLowerInvariant()
    if ($item.Length -le 2097152 -and @(".bat", ".css", ".env", ".html", ".js", ".json", ".md", ".ps1", ".txt", ".yml", ".yaml", ".gyp") -contains $extension) {
      $text = Get-Content -Raw -Encoding UTF8 -LiteralPath $item.FullName
      if ($text -match 'T5_SENTINEL_SECRET|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----' -or
          $text -match '(?im)^\s*(LINGGAN_API_TOKEN|WECOM_SECRET|WECOM_CORP_SECRET|DINGTALK_CLIENT_SECRET|GITHUB_TOKEN|GH_TOKEN)\s*=\s*["'']?[A-Za-z0-9_+./=-]{8,}') {
        throw "Secret-like content found in fresh extraction: $relative"
      }
    }
  }
}

function Get-FreePort {
  $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
  $listener.Start()
  try { return ([Net.IPEndPoint]$listener.LocalEndpoint).Port } finally { $listener.Stop() }
}

if (-not (Test-Path -LiteralPath $releaseDir -PathType Container)) { throw "Release directory does not exist: $releaseDir" }
$checksumCandidates = @(Get-ChildItem -LiteralPath $releaseDir -File | Where-Object { $_.Name -ieq "SHA256SUMS.txt" })
if ($checksumCandidates.Count -ne 1 -or $checksumCandidates[0].Name -cne "SHA256SUMS.txt") { throw "Checksum asset name must be exactly SHA256SUMS.txt." }
foreach ($name in $assetNames) {
  if (-not (Test-Path -LiteralPath (Join-Path $releaseDir $name) -PathType Leaf)) { throw "Release asset is missing: $name" }
}

$checksumLines = @(Get-Content -LiteralPath $checksumPath)
if ($checksumLines.Count -ne $assetNames.Count) { throw "SHA256SUMS.txt has an unexpected asset count." }
$checksummed = New-Object System.Collections.Generic.List[string]
foreach ($line in $checksumLines) {
  if ($line -notmatch '^([a-f0-9]{64})  ([^/\\]+)$') { throw "Malformed SHA256SUMS.txt line: $line" }
  $name = $Matches[2]
  if ($checksummed.Contains($name)) { throw "Duplicate checksum asset: $name" }
  $checksummed.Add($name)
  $asset = Join-Path $releaseDir $name
  if (-not (Test-Path -LiteralPath $asset -PathType Leaf) -or (Get-Hash $asset) -ne $Matches[1]) { throw "Checksum mismatch: $name" }
}
if ((@($checksummed | Sort-Object) -join "`n") -cne ($assetNames -join "`n")) { throw "SHA256SUMS.txt does not name the exact release asset list." }

if ($ComparisonDirectory) {
  $comparison = [IO.Path]::GetFullPath($ComparisonDirectory)
  foreach ($name in @($assetNames) + @("SHA256SUMS.txt")) {
    $other = Join-Path $comparison $name
    if (-not (Test-Path -LiteralPath $other -PathType Leaf) -or (Get-Hash (Join-Path $releaseDir $name)) -ne (Get-Hash $other)) {
      throw "Reproducible build mismatch: $name"
    }
  }
}

try {
  New-Item -ItemType Directory -Path $drillRoot -Force | Out-Null
  $baseZip = Join-Path $releaseDir "$baseName.zip"
  $portableZip = Join-Path $releaseDir "$portableName.zip"
  Assert-SafeZip $baseZip $baseName
  Assert-SafeZip $portableZip $portableName
  $baseExtract = Join-Path $drillRoot "base"
  $portableExtract = Join-Path $drillRoot "portable"
  Expand-Archive -LiteralPath $baseZip -DestinationPath $baseExtract
  Expand-Archive -LiteralPath $portableZip -DestinationPath $portableExtract
  $baseRoot = Join-Path $baseExtract $baseName
  $portableRoot = Join-Path $portableExtract $portableName
  $baseManifest = Assert-Manifest $baseRoot (Join-Path $releaseDir "$baseName.manifest.json")
  $portableManifest = Assert-Manifest $portableRoot (Join-Path $releaseDir "$portableName.manifest.json")
  Assert-NoForbiddenContent $baseRoot
  Assert-NoForbiddenContent $portableRoot

  $sourceAllowlist = @(Get-Content -Encoding UTF8 -LiteralPath (Join-Path $projectRoot "scripts\release-allowlist.txt") | ForEach-Object {
    if ($_.Trim() -match '^source\s+(.+)$') { $Matches[1].Trim() }
  } | Where-Object { $_ } | Sort-Object -CaseSensitive)
  $basePaths = @(Get-Inventory $baseRoot | ForEach-Object { $_.path })
  if (($sourceAllowlist -join "`n") -cne ($basePaths -join "`n")) { throw "Fresh base package does not exactly match the source allowlist." }

  $nodeExe = Join-Path $portableRoot "runtime\node.exe"
  if ((Get-Hash $nodeExe) -ne $runtime.nodeExecutableSha256) { throw "Packaged node.exe hash does not match scripts/runtime-node.json." }
  $nodeVersion = (& $nodeExe --version).Trim()
  if ($nodeVersion -ne "v$($runtime.version)") { throw "Packaged Node.js version mismatch: $nodeVersion" }
  if (-not (Test-Path -LiteralPath (Join-Path $portableRoot "build\Release\volume_lock.node") -PathType Leaf)) { throw "Packaged native volume lock binding is missing." }
  if ($portableManifest.runtime.archiveSha256 -ne $runtime.sha256 -or $portableManifest.runtime.nodeExecutableSha256 -ne $runtime.nodeExecutableSha256) {
    throw "Portable manifest runtime evidence does not match scripts/runtime-node.json."
  }

  $realData = Join-Path $projectRoot "DATA.md"
  $beforeHash = if (Test-Path -LiteralPath $realData -PathType Leaf) { Get-Hash $realData } else { $null }
  $beforeTime = if (Test-Path -LiteralPath $realData -PathType Leaf) { (Get-Item -LiteralPath $realData).LastWriteTimeUtc } else { $null }
  $dataRoot = Join-Path $drillRoot "data"
  New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
  $port = Get-FreePort
  $env:PORT = "$port"
  $env:HOST = "127.0.0.1"
  $env:NO_OPEN = "1"
  $env:README_FILE = Join-Path $dataRoot "DATA.md"
  $env:ENTRIES_DIR = Join-Path $dataRoot "entries"
  $env:AUDIT_LOG_FILE = Join-Path $dataRoot "audit.log"
  $env:LINGGAN_API_TOKEN = "t5-release-drill-local-token"
  $env:HTTP_PROXY = "http://127.0.0.1:9"
  $env:HTTPS_PROXY = "http://127.0.0.1:9"
  $env:NO_PROXY = "127.0.0.1,localhost"
  $stdout = Join-Path $drillRoot "server.stdout.txt"
  $stderr = Join-Path $drillRoot "server.stderr.txt"
  $serverProcess = Start-Process -FilePath $nodeExe -ArgumentList "server.js" -WorkingDirectory $portableRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  $origin = "http://127.0.0.1:$port"
  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try {
      $health = Invoke-WebRequest -UseBasicParsing -Uri "$origin/api/health" -Headers @{ "X-Linggan-Token" = $env:LINGGAN_API_TOKEN } -TimeoutSec 1
      if ($health.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
    if ($serverProcess.HasExited) { break }
    Start-Sleep -Milliseconds 250
  }
  if (-not $ready) {
    $output = (Get-Content -Raw -ErrorAction SilentlyContinue -LiteralPath $stdout) + (Get-Content -Raw -ErrorAction SilentlyContinue -LiteralPath $stderr)
    throw "Fresh portable offline startup failed. $output"
  }
  $body = @{ url = "https://offline.invalid/release-drill"; name = "offline release drill" } | ConvertTo-Json
  $write = Invoke-WebRequest -UseBasicParsing -Uri "$origin/api/add" -Method Post -Headers @{
    "X-Linggan-Token" = $env:LINGGAN_API_TOKEN
    "Idempotency-Key" = [guid]::NewGuid().ToString()
  } -ContentType "application/json" -Body $body -TimeoutSec 10
  if ($write.StatusCode -ne 200 -or -not (($write.Content | ConvertFrom-Json).ok)) { throw "Fresh portable offline write failed." }
  if ((Get-Content -Raw -Encoding UTF8 -LiteralPath $env:README_FILE) -notmatch 'https://offline\.invalid/release-drill') { throw "Fresh portable write was not persisted to disposable data." }
  $afterHash = if (Test-Path -LiteralPath $realData -PathType Leaf) { Get-Hash $realData } else { $null }
  $afterTime = if (Test-Path -LiteralPath $realData -PathType Leaf) { (Get-Item -LiteralPath $realData).LastWriteTimeUtc } else { $null }
  if ($afterHash -ne $beforeHash -or $afterTime -ne $beforeTime) { throw "Release drill touched repository DATA.md." }

  $evidence = [ordered]@{
    schemaVersion = 1
    passed = $true
    version = $version
    node = $nodeVersion
    checksumAsset = "SHA256SUMS.txt"
    assets = $assetNames
    reproducibleComparison = [bool]$ComparisonDirectory
    allowlistVerified = $true
    manifestsVerified = $true
    freshExtractionVerified = $true
    offlineStartupAndWrite = $true
    repositoryDataUnchanged = $true
  }
  if ($EvidencePath) {
    $resolvedEvidence = [IO.Path]::GetFullPath($EvidencePath)
    New-Item -ItemType Directory -Path (Split-Path -Parent $resolvedEvidence) -Force | Out-Null
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($resolvedEvidence, (($evidence | ConvertTo-Json -Depth 4) + "`n"), $utf8NoBom)
  }
  Write-Host "Release drill passed: allowlist, manifests, checksums, fresh extraction, pinned runtime, and offline startup/write."
} finally {
  if ($serverProcess -and -not $serverProcess.HasExited) { Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue }
  if ((Test-Path -LiteralPath $drillRoot) -and $drillRoot.StartsWith($safePrefix, [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $drillRoot -Recurse -Force
  }
}
