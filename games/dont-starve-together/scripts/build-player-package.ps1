param([string]$OutputDirectory, [switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent (Split-Path -Parent $projectRoot)
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'dist' }
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
if (-not $SkipBuild) {
    pnpm --dir (Join-Path $repoRoot 'plugins/xiaotangyuan-game') run build
    if ($LASTEXITCODE -ne 0) { throw 'TypeScript Adapter build failed' }
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$animation = [IO.Compression.ZipFile]::OpenRead((Join-Path $projectRoot 'game-mod/anim/jingling.zip'))
try {
    $names = @($animation.Entries | ForEach-Object { $_.FullName })
    if ('anim.bin' -notin $names -or 'build.bin' -notin $names) { throw 'Compiled Jingling animation is invalid' }
} finally { $animation.Dispose() }
# Fresh build tree; no installed game or source tree is deleted.
$staging = Join-Path $outputRoot ('build-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging | Out-Null
$payload = Join-Path $staging 'mod'
node (Join-Path $repoRoot 'plugins/xiaotangyuan-game/dist/runtime/adapters/dst/build-package.js') (Join-Path $projectRoot 'game-mod') $payload
if ($LASTEXITCODE -ne 0) { throw 'Standalone TS package build failed' }
$manifest = Get-Content -Raw -LiteralPath (Join-Path $payload 'dst-runtime.json') | ConvertFrom-Json
$assetName = "dsh-xiaotangyuan-game-dont-starve-$($manifest.version).zip"
$assetPath = Join-Path $outputRoot $assetName
Compress-Archive -LiteralPath $payload -DestinationPath $assetPath -CompressionLevel Optimal -Force
$hashStream = [IO.File]::OpenRead($assetPath)
$hashAlgorithm = [Security.Cryptography.SHA256]::Create()
try { $assetHash = ([BitConverter]::ToString($hashAlgorithm.ComputeHash($hashStream))).Replace('-', '').ToLowerInvariant() }
finally { $hashAlgorithm.Dispose(); $hashStream.Dispose() }
$metadata = [ordered]@{ archive = $assetName; version = $manifest.version; sha256 = $assetHash; platform = $manifest.platform; arch = $manifest.arch }
[IO.File]::WriteAllText((Join-Path $outputRoot 'bundle.json'), ($metadata | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
Write-Host "Built TS player package: $assetPath"
Write-Host "Verified unpacked payload retained: $payload"
