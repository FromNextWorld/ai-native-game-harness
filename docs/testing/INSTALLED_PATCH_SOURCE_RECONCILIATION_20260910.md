# Installed patch source reconciliation — 2026-09-10

## Scope

User authorized reconciling the already installed patches into `integration/source-unified-20260909`, without commits, pushes, installation, cloud changes or game/save changes. Existing unrelated edits are preserved; original worktrees are read-only inputs. User clarified that the latest DST exit was manual, not a reproduced launch fault.

## Source changes

- `plugins/xiaotangyuan-game/src/runtime/agent/learning-intent-boundary.ts` and its 12 tests imported from `voice-diagnostics-20260909`; GameAgentSession binds and cleans the per-turn boundary and installs the hook. The implementation matches the installed source-built patch, not a reverse-engineered binary edit.
- `GrandpaRenderer.cs` and `ProjectileGroup.cs` reconciled with `stardew-water-animation-20260910/docs/coordination/patches/stardew-grandpa-visual-20260910.patch`: 120px grandpa, 192px door, 40 larger particles, fixed companion-relative (96,-56) origin and 0.40-second per-target timing.
- Projectile tests assert the new origin and wait 25 ticks instead of 23 to cross the new 0.40-second water-impact boundary.
- `scripts/smoke-learning-boundary.mjs` makes the source-owned boundary regression reproducible with this tree's build, a separate temporary Profile, loopback ports and a mock model/game. It does not call paid providers or use player sessions.

## Verification

- Game build and tests: 314 passed.
- Core integration: 64 passed.
- Platform tests: 22 passed.
- Projectile/controller tests: 226 checks passed, including real loopback WebSocket but simulated game state.
- Mod Release build: 0 warnings, 0 errors; `EnableModDeploy=false` and `EnableModZip=false` explicitly prevent installation.
- Transparent atlas and exact embedded source PNG check passed.
- All 58 newly built plugin JavaScript files match installed Runtime byte-for-byte.
- Compared the Mod adapter with the source snapshot used for the installed visual patch: all 57 source/assets files agree (line-ending normalization for text). The snapshot's extra `GrandpaVisual.AssemblyInfo.cs` is manual compiler metadata replaced by standard SDK-generated metadata; it is intentionally not copied to avoid duplicate assembly attributes. Binary hashes are not claimed identical across the two compiler invocations.
- Real DSH + mock model/game regression passed: wrong learning request rejected, learning tools removed for the remainder of the turn, exactly one `stardew.projectiles_create`, no errors, child exited.
- Git whitespace check passed (existing LF/CRLF warnings only).
- Full `desktop:prepare` completed after transient npm connection retries; seal and independent verify passed for all three plugin payloads and archive/runtime parity. Source ID: `4598f1cabc212f54c394eff3e7a85359b0eb940f77a3a326dbecfc8a3d30bbca` (`.artifacts/source-release.json`).
- Re-ran the learning-boundary Runtime smoke against the final newly prepared Runtime: passed, exactly one summon atom, test child exited. Integration preparation also passed chat and reconnect using the same Session.
- Upstream npm peer/deprecation warnings remain (including React/React DOM versions). They were not silently fixed or treated as complete product/UI acceptance.
- Rebuilt Mod DLL SHA-256: `DAC4745248068353C0C950D935062BB01D7E8EA0A10723A028EC25A7FDD74B94`; retained locally under `games/stardew-valley/adapter/bin/Release/net6.0` without installation.

## Reproduction

The system `dotnet` currently supplies only a runtime. Use the existing SDK in a command-scoped environment, not a machine-wide settings change:

```powershell
$env:PATH = 'C:\Users\10354\.cache\dotnet-sdk;' + $env:PATH
$env:DOTNET_ROOT = 'C:\Users\10354\.cache\dotnet-sdk'
pnpm --filter @qimidandapigu/dsh-xiaotangyuan-game run check
dotnet run --project games/stardew-valley/tests/projectiles/Projectile.Tests.csproj -c Release
dotnet build games/stardew-valley/adapter/StardewAgentMod.csproj -c Release -p:GamePath='C:/steam/steamapps/common/Stardew Valley' -p:EnableModDeploy=false -p:EnableModZip=false
pnpm desktop:prepare
node scripts/smoke-learning-boundary.mjs
node scripts/release-source.mjs verify
```

## Remaining boundaries

- ONI water-feedback work, native settings UI and MiniMax thinking-policy changes were not installed and are not included in this reconciliation.
- No edits to private source, private release pin, root package/lockfile, installed application/Profile, Steam Mod or saves in this turn.
- This is unified-source/build verification, not a published installer. Formal private release remains pinned to its existing Git revision until the user authorizes an integrated commit and release pin change; the guard must not silently package the old pin as the new source.
- Desktop payload and Stardew Mod are separate deliverables. The Mod was rebuilt from the unified source; no remote Mod release was published or substituted.
- Real microphone and in-game rendering are still player acceptance checks. Existing user application remains running; the isolated smoke service exits.
