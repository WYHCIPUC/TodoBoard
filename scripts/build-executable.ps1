param(
  [string]$OutputDirectory = "",
  [string]$ProjectRoot = "",
  [string]$RuntimeArchive = "",
  [string]$NodeVersion = "",
  [switch]$Force
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$projectRoot = if ($ProjectRoot) { [IO.Path]::GetFullPath($ProjectRoot) } else { (Resolve-Path (Join-Path $PSScriptRoot "..")).Path }
$packageJson = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $projectRoot "package.json") | ConvertFrom-Json
$version = [string]$packageJson.version
$baseName = "linggankanban-$version-windows"
$portableName = "$baseName-portable-x64"
$distDir = if ($OutputDirectory) { [IO.Path]::GetFullPath($OutputDirectory) } else { Join-Path $projectRoot "dist" }
$baseArchive = Join-Path $distDir "$baseName.zip"
$baseManifest = Join-Path $distDir "$baseName.manifest.json"
$portableArchive = Join-Path $distDir "$portableName.zip"
$portableManifest = Join-Path $distDir "$portableName.manifest.json"
$executablePath = Join-Path $distDir "linggankanban-$version-windows-x64.exe"
$checksumPath = Join-Path $distDir "SHA256SUMS.txt"
$launcherProject = Join-Path $projectRoot "launcher\LingganLauncher.csproj"
$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$buildRoot = [IO.Path]::GetFullPath((Join-Path $tempBase ("linggan-exe-" + [guid]::NewGuid().ToString("N"))))
$packageStageDir = Join-Path $buildRoot "packages"
$publishDir = Join-Path $buildRoot "publish"
$intermediateDir = (Join-Path $buildRoot "obj") + [IO.Path]::DirectorySeparatorChar
$compileOutputDir = (Join-Path $buildRoot "bin") + [IO.Path]::DirectorySeparatorChar
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Get-Hash([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return (($algorithm.ComputeHash($stream) | ForEach-Object { $_.ToString("x2") }) -join "") }
  finally { $algorithm.Dispose(); $stream.Dispose() }
}

$expectedNames = @(
  "$baseName.zip",
  "$baseName.manifest.json",
  "$portableName.zip",
  "$portableName.manifest.json",
  "linggankanban-$version-windows-x64.exe",
  "SHA256SUMS.txt"
)
$existing = @($expectedNames | ForEach-Object { Join-Path $distDir $_ } | Where-Object { Test-Path -LiteralPath $_ })
if ($existing -and -not $Force) { throw "Release output already exists: $($existing -join ', '). Choose a new -OutputDirectory." }

try {
  New-Item -ItemType Directory -Path $packageStageDir, $publishDir, $intermediateDir, $compileOutputDir -Force | Out-Null
  $portableArgs = @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $projectRoot "scripts\build-portable.ps1"),
    "-ProjectRoot", $projectRoot, "-OutputDirectory", $packageStageDir
  )
  if ($RuntimeArchive) { $portableArgs += @("-RuntimeArchive", [IO.Path]::GetFullPath($RuntimeArchive)) }
  if ($NodeVersion) { $portableArgs += @("-NodeVersion", $NodeVersion) }
  & powershell @portableArgs
  if ($LASTEXITCODE -ne 0) { throw "Portable package build failed." }

  $stagedPortableArchive = Join-Path $packageStageDir "$portableName.zip"
  $stagedBaseArchive = Join-Path $packageStageDir "$baseName.zip"
  foreach ($required in @($stagedPortableArchive, $stagedBaseArchive, (Join-Path $packageStageDir "$baseName.manifest.json"), (Join-Path $packageStageDir "$portableName.manifest.json"))) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required staged package is missing: $required" }
  }

  $pathMap = "$projectRoot=/_/src"
  & dotnet publish $launcherProject `
    -c Release `
    -r win-x64 `
    --self-contained true `
    "-p:Version=$version" `
    "-p:InformationalVersion=$version" `
    "-p:PayloadArchive=$stagedPortableArchive" `
    "-p:BaseIntermediateOutputPath=$intermediateDir" `
    "-p:MSBuildProjectExtensionsPath=$intermediateDir" `
    "-p:BaseOutputPath=$compileOutputDir" `
    "-p:Deterministic=true" `
    "-p:ContinuousIntegrationBuild=true" `
    "-p:DebugType=None" `
    "-p:DebugSymbols=false" `
    "-p:PathMap=$pathMap" `
    -o $publishDir
  if ($LASTEXITCODE -ne 0) { throw "Single-file launcher compilation failed." }

  $builtExecutable = Join-Path $publishDir "LingganKanban.exe"
  if (-not (Test-Path -LiteralPath $builtExecutable -PathType Leaf)) { throw "Compiled executable is missing: $builtExecutable" }
  New-Item -ItemType Directory -Path $distDir -Force | Out-Null

  $copies = @(
    @($stagedBaseArchive, $baseArchive),
    @((Join-Path $packageStageDir "$baseName.manifest.json"), $baseManifest),
    @($stagedPortableArchive, $portableArchive),
    @((Join-Path $packageStageDir "$portableName.manifest.json"), $portableManifest),
    @($builtExecutable, $executablePath)
  )
  foreach ($pair in $copies) {
    if ((Test-Path -LiteralPath $pair[1]) -and -not $Force) { throw "Release output appeared during the build: $($pair[1])" }
    [IO.File]::Copy($pair[0], $pair[1], [bool]$Force)
  }

  $assets = @($copies | ForEach-Object { $_[1] } | Sort-Object { [IO.Path]::GetFileName($_) })
  $checksumLines = @($assets | ForEach-Object {
    $hash = Get-Hash $_
    "$hash  $([IO.Path]::GetFileName($_))"
  })
  [IO.File]::WriteAllText($checksumPath, ($checksumLines -join "`n") + "`n", $utf8NoBom)

  foreach ($line in Get-Content -LiteralPath $checksumPath) {
    if ($line -notmatch '^([a-f0-9]{64})  ([^/\\]+)$') { throw "Generated SHA256SUMS.txt is malformed." }
    $asset = Join-Path $distDir $Matches[2]
    if (-not (Test-Path -LiteralPath $asset -PathType Leaf) -or
        (Get-Hash $asset) -ne $Matches[1]) {
      throw "Generated checksum verification failed: $($Matches[2])"
    }
  }
  Write-Host "Single-file executable created: $executablePath"
  Write-Host "Checksums created and verified: $checksumPath"
} finally {
  $safePrefix = $tempBase.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if ((Test-Path -LiteralPath $buildRoot) -and $buildRoot.StartsWith($safePrefix, [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $buildRoot -Recurse -Force
  }
}
