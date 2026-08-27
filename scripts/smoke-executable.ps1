param(
  [string]$ExecutablePath,
  [int]$Port = 39877
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $ExecutablePath) {
  $packageJson = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $projectRoot "package.json") | ConvertFrom-Json
  $ExecutablePath = Join-Path $projectRoot "dist\linggankanban-$($packageJson.version)-windows-x64.exe"
}
$ExecutablePath = (Resolve-Path -LiteralPath $ExecutablePath).Path
if (-not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) { throw "Executable smoke target is not a file." }

$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$smokeRoot = [IO.Path]::GetFullPath((Join-Path $tempBase ("linggan-exe-smoke-" + [guid]::NewGuid().ToString("N"))))
$safePrefix = $tempBase.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $smokeRoot.StartsWith($safePrefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Smoke test path escaped the temp directory." }
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw "Smoke test port $Port is already in use." }

function Get-Sha256([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return (($algorithm.ComputeHash($stream) | ForEach-Object { $_.ToString("x2") }) -join "") }
  finally { $algorithm.Dispose(); $stream.Dispose() }
}

$realData = Join-Path $projectRoot "DATA.md"
$realDataHash = if (Test-Path -LiteralPath $realData -PathType Leaf) { Get-Sha256 $realData } else { $null }
$realDataTime = if (Test-Path -LiteralPath $realData -PathType Leaf) { (Get-Item -LiteralPath $realData).LastWriteTimeUtc } else { $null }

$env:PORT = "$Port"
$env:LINGGAN_DATA_DIR = Join-Path $smokeRoot "data"
$env:LINGGAN_INSTALL_DIR = Join-Path $smokeRoot "app"
$env:LINGGAN_NO_OPEN = "1"
$env:HTTP_PROXY = "http://127.0.0.1:9"
$env:HTTPS_PROXY = "http://127.0.0.1:9"
$env:NO_PROXY = "127.0.0.1,localhost"
$env:DINGTALK_CLIENT_ID = ""
$env:DINGTALK_CLIENT_SECRET = ""
$env:WECOM_CORP_ID = ""
$env:WECOM_SECRET = ""

try {
  $first = Start-Process -FilePath $ExecutablePath -PassThru -WindowStyle Hidden
  if (-not $first.WaitForExit(60000)) {
    Stop-Process -Id $first.Id -Force
    throw "First launcher run timed out."
  }

  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/" -TimeoutSec 1 -SessionVariable webSession
      if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
    Start-Sleep -Milliseconds 250
  }
  if (-not $ready) { throw "Embedded server did not become ready while outbound networking was disabled." }

  $dataFile = Join-Path $smokeRoot "data\DATA.md"
  if (-not (Test-Path -LiteralPath $dataFile -PathType Leaf)) { throw "Disposable DATA.md was not initialized." }
  $readyFile = Get-ChildItem -LiteralPath (Join-Path $smokeRoot "app") -Filter ".ready" -Recurse -File | Select-Object -First 1
  if (-not $readyFile) { throw "Application cache ready marker is missing." }

  $origin = "http://127.0.0.1:$Port"
  $requestId = [guid]::NewGuid().ToString()
  $body = @{ url = "https://offline.invalid/t5-smoke"; name = "T5 offline write"; desc = "packaged write verification" } | ConvertTo-Json
  $add = Invoke-WebRequest -UseBasicParsing -Uri "$origin/api/add" -Method Post -WebSession $webSession `
    -Headers @{ Origin = $origin; "Idempotency-Key" = $requestId } -ContentType "application/json" -Body $body -TimeoutSec 10
  $addJson = $add.Content | ConvertFrom-Json
  if ($add.StatusCode -ne 200 -or -not $addJson.ok) { throw "Packaged read/write smoke request failed." }
  if ((Get-Content -Raw -Encoding UTF8 -LiteralPath $dataFile) -notmatch 'https://offline\.invalid/t5-smoke') { throw "Packaged write was not persisted to disposable data." }

  $health = Invoke-WebRequest -UseBasicParsing -Uri "$origin/api/health" -WebSession $webSession -TimeoutSec 5
  if ($health.StatusCode -ne 200 -or -not (($health.Content | ConvertFrom-Json).ok)) { throw "Packaged health check failed." }

  $firstServerPid = (Get-NetTCPConnection -LocalPort $Port -State Listen | Select-Object -First 1).OwningProcess
  $second = Start-Process -FilePath $ExecutablePath -PassThru -WindowStyle Hidden
  if (-not $second.WaitForExit(30000)) {
    Stop-Process -Id $second.Id -Force
    throw "Second launcher run timed out."
  }
  $secondServerPid = (Get-NetTCPConnection -LocalPort $Port -State Listen | Select-Object -First 1).OwningProcess
  if ($secondServerPid -ne $firstServerPid) { throw "Second launch replaced or duplicated the existing server." }

  $afterHash = if (Test-Path -LiteralPath $realData -PathType Leaf) { Get-Sha256 $realData } else { $null }
  $afterTime = if (Test-Path -LiteralPath $realData -PathType Leaf) { (Get-Item -LiteralPath $realData).LastWriteTimeUtc } else { $null }
  if ($afterHash -ne $realDataHash -or $afterTime -ne $realDataTime) { throw "Executable smoke test touched repository DATA.md." }

  Write-Host "EXE smoke passed: offline startup, HTTP read/write, health, and second-launch reuse."
  Write-Host "Disposable data: $dataFile"
} finally {
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) { Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 300
  if ((Test-Path -LiteralPath $smokeRoot) -and $smokeRoot.StartsWith($safePrefix, [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $smokeRoot -Recurse -Force
  }
}
