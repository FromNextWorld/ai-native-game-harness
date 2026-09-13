param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$appDir = 'C:/Users/10354/AppData/Local/Programs/AI Native Game Harness'
$profileRoot = 'C:/Users/10354/AppData/Roaming/AI Native Game Harness 商业版'
$archive = Join-Path $appDir 'resources/plugins/qimidandapigu-dsh-work-orchestrator-0.1.3.tgz'
$stage = Join-Path $repo ('.artifacts/audit-local-update-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $stage | Out-Null
& tar -xzf $archive -C $stage
if ($LASTEXITCODE -ne 0) { throw 'Cannot extract existing Work archive' }
$original = @{}
Get-ChildItem (Join-Path $stage 'package') -Recurse -File | ForEach-Object { $original[$_.FullName] = (Get-FileHash -LiteralPath $_.FullName).Hash }
$files = @('work-orchestrator-service.js','work-orchestrator-service.js.map','work-orchestrator-service.d.ts','work-orchestrator-service.d.ts.map','work-evidence.js','work-evidence.js.map','work-evidence.d.ts','work-evidence.d.ts.map')
foreach ($file in $files) {
    Copy-Item -LiteralPath (Join-Path $repo "plugins/dsh-work-orchestrator/dist/$file") -Destination (Join-Path $stage "package/dist/$file") -Force
}
foreach ($path in $original.Keys) {
    if ((Split-Path $path -Leaf) -notin $files -and (Get-FileHash -LiteralPath $path).Hash -ne $original[$path]) { throw "Unexpected archive change: $path" }
}
$updatedArchive = Join-Path $stage 'work-updated.tgz'
& tar -czf $updatedArchive -C $stage package
if ($LASTEXITCODE -ne 0) { throw 'Cannot pack updated Work archive' }
$entries = @()
foreach ($profile in @('dsh-home','dsh-home-self-hosted')) {
    $link = Join-Path $profileRoot "$profile/profiles/web/node_modules/@qimidandapigu/dsh-work-orchestrator"
    $target = (Get-Item -LiteralPath $link).Target
    $allowed = [IO.Path]::GetFullPath((Join-Path $profileRoot "$profile/profiles/web/node_modules/.pnpm")) + [IO.Path]::DirectorySeparatorChar
    if (!$target -or ![IO.Path]::GetFullPath($target).StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected Work package target' }
    foreach ($file in $files) { $entries += @{ Source=(Join-Path $stage "package/dist/$file"); Target=(Join-Path $target "dist/$file") } }
}
$entries += @{ Source=$updatedArchive; Target=$archive }
$entries += @{ Source=(Join-Path $repo 'games/stardew-valley/adapter/bin/Release/net6.0/StardewAgentMod.dll'); Target='C:/steam/steamapps/common/Stardew Valley/Mods/StardewAgentMod/StardewAgentMod.dll' }
if (!$Apply) { Write-Output "Prepared only: $stage"; return }
if (Get-Process | Where-Object { $_.ProcessName -match 'Stardew|Harness|SMAPI' }) { throw 'Application/game still running; no deployment performed' }
$backup = Join-Path $stage 'backup'
New-Item -ItemType Directory -Path $backup | Out-Null
$i = 0
foreach ($entry in $entries) {
    if (!(Test-Path -LiteralPath $entry.Source -PathType Leaf)) { throw "Missing source: $($entry.Source)" }
    $entry.Existed = Test-Path -LiteralPath $entry.Target -PathType Leaf
    $entry.Backup = Join-Path $backup "$i.bak"
    $entry.SourceHash = (Get-FileHash -LiteralPath $entry.Source).Hash
    if ($entry.Existed) { Copy-Item -LiteralPath $entry.Target -Destination $entry.Backup }
    $i++
}
$entries | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $stage 'mapping.json') -Encoding UTF8
try {
    foreach ($entry in $entries) {
        Copy-Item -LiteralPath $entry.Source -Destination $entry.Target -Force
        if ((Get-FileHash -LiteralPath $entry.Target).Hash -ne $entry.SourceHash) { throw "Installed hash differs: $($entry.Target)" }
    }
} catch {
    foreach ($entry in $entries) {
        if ($entry.Existed) { Copy-Item -LiteralPath $entry.Backup -Destination $entry.Target -Force }
        elseif (Test-Path -LiteralPath $entry.Target) { Remove-Item -LiteralPath $entry.Target }
    }
    throw
}
Write-Output "Updated and hash-verified $($entries.Count) files. Backup and rollback mapping: $stage"
