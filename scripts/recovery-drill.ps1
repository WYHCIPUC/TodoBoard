param(
  [string]$NodePath = "node",
  [string]$EvidencePath = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$drillRoot = [IO.Path]::GetFullPath((Join-Path $tempBase ("linggan-recovery-drill-" + [guid]::NewGuid().ToString("N"))))
$safePrefix = $tempBase.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $drillRoot.StartsWith($safePrefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Recovery drill path escaped the temp directory." }

function Get-Sha256([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return (($algorithm.ComputeHash($stream) | ForEach-Object { $_.ToString("x2") }) -join "") }
  finally { $algorithm.Dispose(); $stream.Dispose() }
}

$realData = Join-Path $projectRoot "DATA.md"
$beforeHash = if (Test-Path -LiteralPath $realData -PathType Leaf) { Get-Sha256 $realData } else { $null }
$beforeTime = if (Test-Path -LiteralPath $realData -PathType Leaf) { (Get-Item -LiteralPath $realData).LastWriteTimeUtc } else { $null }
$tests = @(
  "lib/backup-format.test.js",
  "lib/backup-transaction.test.js",
  "lib/idempotency.test.js",
  "lib/recovery.test.js",
  "lib/recover-cli.test.js",
  "lib/upgrade.test.js",
  "lib/volume-lock.test.js"
)
$originalEnvironment = @{}
foreach ($name in @("README_FILE", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY")) {
  $originalEnvironment[$name] = [Environment]::GetEnvironmentVariable($name)
}

try {
  New-Item -ItemType Directory -Path $drillRoot -Force | Out-Null
  $dataFile = Join-Path $drillRoot "DATA.md"
  [IO.File]::Copy((Join-Path $projectRoot "DATA.example.md"), $dataFile, $false)
  $env:README_FILE = $dataFile
  $env:HTTP_PROXY = "http://127.0.0.1:9"
  $env:HTTPS_PROXY = "http://127.0.0.1:9"
  $env:NO_PROXY = "127.0.0.1,localhost"

  $arguments = @("scripts/run-tests.js")
  foreach ($test in $tests) { $arguments += @("--test", $test) }
  & $NodePath @arguments
  if ($LASTEXITCODE -ne 0) { throw "Recovery fault-injection suite failed." }
  & $NodePath "scripts/recover.js" "--help"
  if ($LASTEXITCODE -ne 0) { throw "Recovery CLI help gate failed." }

  $afterHash = if (Test-Path -LiteralPath $realData -PathType Leaf) { Get-Sha256 $realData } else { $null }
  $afterTime = if (Test-Path -LiteralPath $realData -PathType Leaf) { (Get-Item -LiteralPath $realData).LastWriteTimeUtc } else { $null }
  if ($afterHash -ne $beforeHash -or $afterTime -ne $beforeTime) { throw "Recovery drill touched repository DATA.md." }

  $evidence = [ordered]@{
    schemaVersion = 1
    passed = $true
    node = (& $NodePath --version).Trim()
    disposableData = $true
    offlineProxy = $true
    repositoryDataUnchanged = $true
    cases = @(
      "interrupted_write",
      "lock_contention_and_owner_crash",
      "ambiguous_candidates_no_guess",
      "upgrade_and_rollback",
      "verification_failure",
      "confirmed_recovery",
      "idempotent_rerun"
    )
    tests = $tests
  }
  if ($EvidencePath) {
    $resolvedEvidence = [IO.Path]::GetFullPath($EvidencePath)
    New-Item -ItemType Directory -Path (Split-Path -Parent $resolvedEvidence) -Force | Out-Null
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($resolvedEvidence, (($evidence | ConvertTo-Json -Depth 4) + "`n"), $utf8NoBom)
  }
  Write-Host "Recovery drill passed: interruption, locks, ambiguity, upgrade/rollback, verification failure, and idempotency."
} finally {
  foreach ($name in $originalEnvironment.Keys) {
    $value = $originalEnvironment[$name]
    if ($null -eq $value) {
      Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
    } else {
      Set-Item -LiteralPath "Env:$name" -Value $value
    }
  }
  if ((Test-Path -LiteralPath $drillRoot) -and $drillRoot.StartsWith($safePrefix, [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $drillRoot -Recurse -Force
  }
}
