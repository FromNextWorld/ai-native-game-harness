# Sword spirit visual refinement — 2026-09-11

- Task: current conversation, continuing the established source-unified integration worktree. No other task contacted or dispatched.
- State: source implemented, regression/build verified; scoped local hot update authorized by “更新把” and completed at 2026-09-11 16:43 +08:00. Installed hash verified; not live-game accepted.
- Source: `C:/game/ai-native-game-harness-worktrees/source-unified-20260909`, branch `integration/source-unified-20260909`, base HEAD `06a870bcd4bedfadd32f18c133b50e31a3945cd7`. Preserve every pre-existing edit.

## Contract before implementation

- Default eight sword babies: four visible two-eye front frames and four real back frames in the resting/returned ring. No side-eye frames, closed-eye redraw, duplicate weapons or new mascot design.
- One native-drawn sword per baby; distinguish the short dark handle, small guard and single outward blade. Keep the existing companion sprite sheet unchanged; only select its verified front/back frames.
- Regular symmetric resting slots and orderly two-lane staging. During actual flight, keep steering/collision tied to the real target, not a cosmetic false trajectory.
- Keep existing count input 1..12 and default 8; do not force Grandpa watering or all protocol callers to 8. Generalize facing balance for other counts.
- A short return is cosmetic only: cancel/complete receipts and all damage/resource effects stop immediately. No new game actions, refunds, repeated impacts or extra model calls. Clear visuals on map change, save exit, death, menu/event, disconnection and a new group.
- Preserve 60-second summon limit, 8-second cooldown, stamina, damage, fishing limits, Grandpa visuals, voice-first/stop semantics, ordinary chat, learning and Work. No model/provider/account/profile/save changes.

## Scope / evidence

- Allowed: `games/stardew-valley/adapter/Game/Combat/Projectile{Renderer,Geometry,Group}.cs`; new focused `games/stardew-valley/tests/projectile-visuals/**`; this claim and a scoped implementation report. Existing projectile test doubles may be updated only for production signature compatibility if necessary.
- Shared Desktop/plugin manifests, root packages/lockfiles, deployment scripts and other games are not part of the change.
- Baseline copies and hashes will be retained under `.artifacts/sword-visual-20260911/baseline`; test the production renderer/controller through recorded SpriteBatch calls against game/graphics doubles. Do not mock the renderer itself.
- First run new behavior assertions against unchanged baseline sources and record assertion failures (not missing dependencies/compile errors); then run the same checks on candidate sources.
- Also run existing native projectile/control/RPC tests, field-scope tests and a full Mod compile with `EnableModDeploy=false`. Verify content-pack source and installed sprite hashes read-only. Source compilation/recorded draws do not prove real GPU rendering or voice/game acceptance.
- No commit, push, installation, game start, process termination, secret output, profile edit or save mutation in this implementation stage. A later hot update must compare live Mod provenance and loaded/recovery copies; do not overwrite running games or unrelated installed patches.

## Initial findings

- Production `ProjectileRenderer` hardcodes the front cell `(0,0,64,64)` and scale `0.6`; the existing 256x64 companion sheet is DRUL with front at x=0 and back at x=128.
- Existing controller tests replace `ProjectileRenderer.Draw` with an empty stub, so they could not catch eight front-facing copies or weapon draw regressions.
- Existing sword groups have no sword return visual (only Grandpa has farewell). Add a bounded non-interactive render tail rather than postponing cancellation or changing receipt semantics.

## Handoff

- Implemented in the three scoped Projectile sources; old test renderer signature gained only the optional rear-view override. New production draw tests compile the real renderer/controller; native PNG is unchanged.
- Final same-suite comparison: untouched baseline 2 pass / 23 fail; candidate 25 pass / 0 fail. Original native controller/RPC 226 checks, field scope 21 assertions, TS sword/recall 42 tests, full Mod build and Grandpa embedded-art check passed.
- `docs/testing/SWORD_VISUAL_REFINEMENT_20260911.md` contains source/artifact hashes, commands, actual-boundary limitations and deployment checklist.
- Candidate DLL/ZIP and captured-native-draw preview are under `.artifacts/sword-visual-20260911/`. Source API, gameplay rates, voice, Work, accounts and installer hotspots are not changed. No installation, game execution, Git publication or cross-task action occurred.
- New test is not wired into CI/packaging; no claimed automatic release gate. True GPU rendering, real microphone and live game results remain pending. Test commands exited; no game or persistent test service started.

## Authorized hot update — 2026-09-11

- Scope: the existing Steam `Mods/StardewAgentMod/StardewAgentMod.dll` only, plus moving its obsolete external PDB to an exact-file backup. Preserve manifest, config, saves, companion PNG and all other Mods. No Harness reinstall, release publication, accounts, provider or Profile edits.
- Preflight: game/Harness process query currently empty; no concurrent known installer/build process detected. Recheck immediately before replacement. Do not close an active game automatically.
- Installed DLL matches the Grandpa hotfix build (`298253F2...`). Compare all 58 files in its source snapshot: only the three intended Projectile files differ; its manual `GrandpaVisual.AssemblyInfo.cs` is replaced by standard SDK metadata. The unrelated Grandpa source/art and other adapter files agree.
- Candidate must match recorded production/source and DLL hashes, fresh scoped regression/build checks, and the content pack's actual two-view sprite sheet. Back up exact old files outside `Mods`, verify unchanged config/save/assets hashes and candidate destination SHA-256 after copy; roll back on any failure.
- Actual installed Harness has only DST in `resources/game-installers`; no bundled Stardew recovery DLL. Its Stardew installer uses remote archives and preserves same/newer installed versions. Inspect duplicate loaded Mod copies before applying; do not rewrite historical backups or older friend installers. This local update is not an updated remote release or installer.
- Completed: only one active Mod manifest found. Fresh 25 visual tests, 226 controller/RPC checks, full Mod build (0 warnings/errors), Grandpa embedded-art check passed. Candidate and newly rebuilt DLL both match `EF0CE12A6A3418824C9847A2C57AAAA376BF376B5B3C064170C1AC400D1AEFEE`.
- Replaced the exact Steam DLL, moved the obsolete external PDB to the scoped backup, and verified all 10 remaining Mod/companion files unchanged. Backup: `.artifacts/sword-visual-20260911/hot-update-backup-20260911`. Full result: `.artifacts/sword-visual-20260911/hot-update-installed.json`.
- No application/game started or killed, no background test service left, no other task contacted, no Git publication or installer release. Player still needs to verify real rendering and voice commands after launching SMAPI.

## Failed player acceptance investigation — 2026-09-12

- User reports “万剑归宗没有生效”. This follow-up diagnoses the latest local run; it does not authorize unrelated service/profile changes or overwrite another task's speech patches.
- Current installed DLL still matches the visual candidate; SMAPI loaded that path and the companion asset in the latest run. This is loading evidence, not visual acceptance.
- Real Session turn 15 received only `归中。`, then the model called `xiaotangyuan_sword_formation_stop`, not summon. The cancel receipt confirmed no active sword group. Its preceding claim about cooldown has no current-turn status/create receipt.
- Next two recordings failed in ASR with HTTP 500 after both streaming and whole-recording fallback attempts. Actual installed extension discards the HTTP error body; installed local bridge maps generic exceptions to 500. Historical upstream cause is therefore unavailable, not proven insufficient funds or provider outage.
- A single 200ms synthetic-silence probe through source verified identical to the installed local handler succeeded in 645ms, empty transcript as expected. Used existing local credentials without printing them; no microphone capture, real recording upload, model/game call, profile change or persistent process. This does not reproduce the intermittent failure or establish speech quality.
- Diagnosis report: `docs/testing/SWORD_SUMMON_FAILURE_20260912.md`. No implementation, deployment, commit/push, process termination or cross-task coordination in this follow-up. Actual voice-to-summon acceptance remains failed/pending.
