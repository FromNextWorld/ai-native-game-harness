$ErrorActionPreference = 'Stop'
$root = 'C:\game\ai-native-game-harness-worktrees\player-help-20260907'
$stage = Join-Path $root '.artifacts/grandpa-install-20260908'
$app = 'C:\Users\10354\AppData\Local\Programs\AI Native Game Harness'
if (Get-Process | Where-Object { $_.ProcessName -match 'Stardew|Harness|SMAPI' }) { throw '请先退出应用和星露谷。' }
$profileLink = 'C:\Users\10354\AppData\Roaming\AI Native Game Harness 商业版\dsh-home\profiles\web\node_modules\@qimidandapigu\dsh-xiaotangyuan-game'
$profile = (Get-Item -LiteralPath $profileLink).Target
if (!$profile -or !$profile.StartsWith('C:\Users\10354\AppData\Roaming\AI Native Game Harness 商业版\dsh-home\profiles\web\node_modules\.pnpm\')) { throw 'Unexpected plugin target' }
$relative = @('gateway/game-gateway.js', 'tools/skill-tools.js', 'tools/sword-formation-tools.js', 'runtime/tasks/sword-formation.js')
$entries = @()
foreach ($rel in $relative) {
    $entries += @{ Source = "$stage/stage/package/dist/$rel"; Target = "$profile/dist/$rel" }
}
$entries += @{ Source = "$stage/plugin-updated.tgz"; Target = "$app/resources/plugins/qimidandapigu-dsh-xiaotangyuan-game-0.7.9.tgz" }
$entries += @{ Source = "$root/games/stardew-valley/adapter/bin/Release/net6.0/StardewAgentMod.dll"; Target = 'C:\steam\steamapps\common\Stardew Valley\Mods\StardewAgentMod\StardewAgentMod.dll' }
$backup = Join-Path $stage ('deployment-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backup | Out-Null
$index = 0
foreach ($entry in $entries) {
    if (!(Test-Path -LiteralPath $entry.Source)) { throw "Missing source: $($entry.Source)" }
    $entry.Backup = Join-Path $backup "$index.bak"
    $entry.Existed = Test-Path -LiteralPath $entry.Target
    if ($entry.Existed) { Copy-Item -LiteralPath $entry.Target -Destination $entry.Backup }
    $index++
}
$entries | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backup 'mapping.json') -Encoding UTF8
try {
    foreach ($entry in $entries) {
        New-Item -ItemType Directory -Force (Split-Path $entry.Target) | Out-Null
        Copy-Item -LiteralPath $entry.Source -Destination $entry.Target -Force
        if ((Get-FileHash -LiteralPath $entry.Source).Hash -ne (Get-FileHash -LiteralPath $entry.Target).Hash) { throw 'Installed hash mismatch' }
    }
} catch {
    foreach ($entry in $entries) {
        if ($entry.Existed) { Copy-Item -LiteralPath $entry.Backup -Destination $entry.Target -Force }
        elseif (Test-Path -LiteralPath $entry.Target) { Remove-Item -LiteralPath $entry.Target }
    }
    throw
}
Write-Output "Installed and hash-verified $($entries.Count) scoped files. Backup: $backup"
