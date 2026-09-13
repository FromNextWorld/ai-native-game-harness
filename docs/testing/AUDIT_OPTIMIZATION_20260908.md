# Audit optimization checkpoint — 2026-09-08

## Implemented in this worktree

- Work evidence: conservative PowerShell statement parsing rejects comments, printed commands, here-strings, conditional blocks and WhatIf open commands. Runtime captures pre-turn size/mtime/ctime and requires a changed or newly created candidate artifact; Windows case changes and skipped junction paths cannot count as new artifacts. Snapshot is capped at 50,000 entries and fails explicitly beyond that bound.
- Verification retry explains write/edit and a simple, separate Start-Process command. Complex commands can be rejected even when valid; this is deliberately not a full PowerShell interpreter. File stamps do not prove semantic content correctness; a successful launch receipt does not prove a visible browser/editor window.
- Grandpa watering: world-space origin captured on creation, not recomputed from the moving companion. RPC cancellation stops effects immediately and retains a one-second cosmetic return. Repeated cancellation cannot restart work or the timer. Map changes, save exit and safety cancellation remove the visual tail.
- Added read-only sampled parity check: `games/stardew-valley/tests/check-local-feature-parity.ps1`. Compares selected compiled Work/sword files in both Profiles plus the Steam Mod DLL. It intentionally fails on missing/different files; it is not a complete release manifest.

## Verification

- Work build and tests: 17/17 pass.
- XiaoTangYuan plugin: 244/244 pass.
- Native controller and actual loopback WebSocket: 225 checks pass. Renderer double captures fixed origin/return flag; no actual GPU render acceptance.
- Stardew Mod Release build: zero warnings/errors; deployment disabled.
- Atlas check: four populated transparent cells, exact source image embedded in compiled DLL.
- `git diff --check`: passed (existing LF/CRLF warnings only).

## Deployment / remaining work

- No running application was stopped or overwritten this turn. No account, pricing, provider keys or Profile configuration changed. No commit/push/main merge.
- Desktop remains running. Both installed Work copies lack this new evidence helper; installed Mod remains the prior build.
- Official Profile has the grandpa tool; self-hosted Profile still lacks it. Do not copy the entire worktree plugin over it without checking dependency and unrelated-feature differences.
- Main remains `06a870b`; the new gameplay features are still worktree changes. Shared release manifests/version numbers/installer config were not modified under this task's boundary.
- Current Mod SHA256: `7E7E4ED43AF75D6FCEAA1A905F507D0881DCFE1810AB9251E7E165ABCAE31889`.
- Installed Mod SHA256: `AB946E7FD00A5089C114F91C4F3893FB355E0E733631D4D279BA048DA1DECFEC`.
- Next: controlled exit, backed-up scoped update including bundled archives, verify both Profiles; then real voice summon, move while watering, recall during watering, confirm no post-cancel soil changes. No claim of real-game success yet.
