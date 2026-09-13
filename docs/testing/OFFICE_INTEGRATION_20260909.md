# Office and local plugin integration — 2026-09-09

## Changes

- Work follow-ups inherit artifact format, not historical research/write/open actions from the title.
- Opening an existing final HTML does not require rewriting it or researching again; an unrelated file type does not satisfy the request.
- Conservative PowerShell research evidence rejects comments, printed commands, here-strings, conditional blocks, and invalidated WebClient variables. This is not a full shell interpreter and does not prove source quality.
- The newer Work game-context tool and installed game skill-learning/diagnostics were preserved.
- Official profile, self-hosted profile and bundled Runtime now contain identical Work/game dist trees. Work has 7 JavaScript modules, game has 51.
- Both built-in recovery archives are synchronized. No account, key, balance, cloud service, app.asar or Steam Mod was edited.

## Evidence

- `pnpm --filter @qimidandapigu/dsh-work-orchestrator check`: 36/36.
- New regression file: 17 cases; existing game-context tests retained.
- Three installed roots: full entry-point imports, office follow-up checks, inert research rejection, game-context availability and simulated sword summon/recall pass. Grandpa and learning tools remain registered.
- Paid model calls: 0. Actual game actions: 0. These probes do not prove real microphone or gameplay behavior.
- Cold start: DSH Web and game Gateway 33145 became ready. Verification repeated after built-in package preparation; updated hashes survived restart.
- Started PID 14544 solely for hidden startup smoke. CloseMainWindow returned false because there was no visible main window; the explicitly owned smoke process tree was terminated. This is NOT evidence of graceful normal-window shutdown. No smoke processes intentionally left running.

## Reproduction and backup

From this worktree:

```powershell
node scripts/integrate-office-local.mjs prepare
node scripts/integrate-office-local.mjs install <prepared-stage>
node scripts/integrate-office-local.mjs verify <prepared-stage>
```

Used stage: `C:/game/ai-native-game-harness-worktrees/voice-diagnostics-20260909/.artifacts/office-integration-6Azziz`.
Contains 91-file installation plan with pre/post SHA256, backup of replaced files, archive roundtrip hashes, frozen Work source/tests, and post-install verification. Installation refuses a running app/game, changed baseline, incompatible package dependency metadata or unexpected payload files; failed verification rolls back the batch.

## Release boundary — NOT complete

This is a recoverable local hot-update, not a new source-built installer or public release. The game plugin intentionally retains the newer installed composite instead of replacing it with an older worktree build. The manifest explicitly records `sourceBuiltRelease: false`.

The remaining release task is to reconcile that composite with source, select one reviewed source snapshot, build all distributions from it and pin that snapshot in packaging. Merely matching version strings or uploading the current main does not achieve this. Do not advertise the frozen installed payload as reproducible from main.

No commits, pushes, main merges, version/lock changes, public releases, private cloud edits or cross-task dispatch occurred.
