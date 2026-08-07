param(
  [string]$ExecutablePath,
  [int]$Port = 39877
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $ExecutablePath) {
  $packageJson = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $projectRoot "package.json") | ConvertFrom-Json
  $ExecutablePath = Join-Path $projectRoot "dist\linggankanban-$($packageJson.version)-windows-x64.exe"
}
$ExecutablePath = (Resolve-Path -LiteralPath $ExecutablePath).Path

$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$smokeRoot = [IO.Path]::GetFullPath((Join-Path $tempRoot ("linggan-exe-smoke-" + [guid]::NewGuid().ToString("N"))))
if (-not $smokeRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Smoke test path escaped the temp directory."
}
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
  throw "Smoke test port $Port is already in use."
}

$env:PORT = "$Port"
$env:LINGGAN_DATA_DIR = Join-Path $smokeRoot "data"
$env:LINGGAN_INSTALL_DIR = Join-Path $smokeRoot "app"
$env:LINGGAN_NO_OPEN = "1"

try {
  $first = Start-Process -FilePath $ExecutablePath -PassThru
  if (-not $first.WaitForExit(60000)) {
    Stop-Process -Id $first.Id -Force
    throw "First launcher run timed out."
  }

  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/" -TimeoutSec 1
      if ($response.StatusCode -eq 200) {
        $ready = $true
        break
      }
    } catch {
      # The server may still be starting.
    }
    Start-Sleep -Milliseconds 250
  }
  if (-not $ready) { throw "Embedded server did not become ready." }

  $dataFile = Join-Path $smokeRoot "data\DATA.md"
  if (-not (Test-Path -LiteralPath $dataFile)) { throw "Stable DATA.md was not initialized." }
  $readyFile = Get-ChildItem -LiteralPath (Join-Path $smokeRoot "app") -Filter ".ready" -Recurse -File | Select-Object -First 1
  if (-not $readyFile) { throw "Application cache ready marker is missing." }

  $firstServerPid = (Get-NetTCPConnection -LocalPort $Port -State Listen | Select-Object -First 1).OwningProcess
  $second = Start-Process -FilePath $ExecutablePath -PassThru
  if (-not $second.WaitForExit(30000)) {
    Stop-Process -Id $second.Id -Force
    throw "Second launcher run timed out."
  }
  $secondServerPid = (Get-NetTCPConnection -LocalPort $Port -State Listen | Select-Object -First 1).OwningProcess
  if ($secondServerPid -ne $firstServerPid) {
    throw "Second launch replaced or duplicated the existing server."
  }

  Write-Host "EXE smoke test passed: HTTP 200, PID $firstServerPid"
  Write-Host "Data initialized: $dataFile"
  Write-Host "Cache initialized: $($readyFile.DirectoryName)"
  Write-Host "Second launch reused server PID $secondServerPid"
} finally {
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Milliseconds 300
  if ((Test-Path -LiteralPath $smokeRoot) -and $smokeRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $smokeRoot -Recurse -Force
  }
}
