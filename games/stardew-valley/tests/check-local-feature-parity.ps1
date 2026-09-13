param(
    [string]$ProfileRoot = (Join-Path $env:APPDATA 'AI Native Game Harness 商业版'),
    [string]$GameRoot = 'C:/steam/steamapps/common/Stardew Valley'
)
$ErrorActionPreference = 'Stop'
# Read-only sampled feature parity check, not a whole-release manifest or installer.
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
function HashOrMissing([string]$Path) {
    if (Test-Path -LiteralPath $Path -PathType Leaf) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash }
    return $null
}
$entries = @(
    @{ Package='dsh-work-orchestrator'; Source='dsh-work-orchestrator'; File='dist/work-orchestrator-service.js' },
    @{ Package='dsh-work-orchestrator'; Source='dsh-work-orchestrator'; File='dist/work-evidence.js' },
    @{ Package='dsh-xiaotangyuan-game'; Source='xiaotangyuan-game'; File='dist/tools/sword-formation-tools.js' },
    @{ Package='dsh-xiaotangyuan-game'; Source='xiaotangyuan-game'; File='dist/runtime/tasks/sword-formation.js' }
)
$rows = @(foreach ($profile in @('dsh-home', 'dsh-home-self-hosted')) {
    foreach ($entry in $entries) {
        $source = HashOrMissing (Join-Path $repo "plugins/$($entry.Source)/$($entry.File)")
        $installed = HashOrMissing (Join-Path $ProfileRoot "$profile/profiles/web/node_modules/@qimidandapigu/$($entry.Package)/$($entry.File)")
        [pscustomobject]@{ Profile=$profile; File="$($entry.Package)/$($entry.File)"; SourceHash=$source; InstalledHash=$installed; Matches=($null -ne $source -and $source -eq $installed) }
    }
})
$sourceMod = HashOrMissing (Join-Path $repo 'games/stardew-valley/adapter/bin/Release/net6.0/StardewAgentMod.dll')
$installedMod = HashOrMissing (Join-Path $GameRoot 'Mods/StardewAgentMod/StardewAgentMod.dll')
$rows += [pscustomobject]@{ Profile='Steam'; File='StardewAgentMod.dll'; SourceHash=$sourceMod; InstalledHash=$installedMod; Matches=($null -ne $sourceMod -and $sourceMod -eq $installedMod) }
$rows | ConvertTo-Json
if ($rows.Matches -contains $false) { exit 2 }
