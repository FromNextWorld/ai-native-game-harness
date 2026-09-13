# Systematic reliability optimization

## Scope and acceptance

This increment changes task outcome acceptance, learning-generation budgets, and voice readiness. It does not claim whole-product or real-game acceptance. No Git commit, cloud mutation, paid provider test, or account/save migration.

## Changes

- Shared `assertTurnSucceeded` requires a current `turn/end` and rejects errors, cancellation, blocking, interruption and token exhaustion. A later success in the same batch cannot hide a failure.
- Office invokes this guard before accepting text. Verification repair reads only the repair turn's new public text; evidence can still include valid files/actions from the original attempt.
- Game invokes the same guard after the original request and each learning revision. Driver-contained failures no longer fall through to acknowledgement text.
- Learning requests receive 4096 tokens per model step; ordinary companion replies retain 512. Budgets are scoped by Session and removed in `finally`; original attempt/deadline/skill sandbox constraints remain.
- Speech startup checks ASR and TTS independently. A failed provider check no longer prevents the media service from starting.
- Readiness reports `configured` separately from real use, and media `ready` requires its child-process handshake. Missing startup handshake expires after 15 seconds; process error/exit changes readiness to unavailable.
- Closing during provider discovery prevents a late media-process spawn.
- Desktop retains voice readiness outside its bounded trace history and displays human-readable status in the analysis page. Gateway/model connectivity never implies microphone, ASR or TTS acceptance.

## Regression evidence

- Work check: 44 tests passed, including a public reply followed by a driver-contained provider failure.
- Game build and full suite: 297 tests passed, including the independent 15-second timeout regression.
- Integration: 64 passed; platform: 22 passed. The dual-Session fake driver was corrected to emit the real driver's terminal event rather than implicitly treating idle as success.
- Private check passed; JS tests 46 passed and one Windows symlink-permission skip. Secret scan passed.
- Full build sealed source ID `b1998e8d1b6792aff9c7252e26c80056b914e6eb9b8393b3e0e31209c1dd325a`; real DSH local-model smoke passed chat and resumed chat.
- Desktop isolated smoke: preload loaded, DSH Web ready, 33145 listening, single instance, isolated Profile, zero residual processes.
- Existing installation directly updated: 78 files, zero stale files removed, settings unchanged, no backup/rollback. Private evidence: `.artifacts/local-update-guIUNm/installed-verification.json`.
- Actual installed startup passed: Web, product bridge, gateway, ASR/TTS configuration and media host handshake; microphone explicitly remains untested. Installed app archive and active Profile Game/Work dist match the new build after startup.
- Installed app left running (main PID 52416, gateway PID 15928 at verification). No real game launched.

## Remaining acceptance

- Real V-key microphone recognition, audible output and failure recovery in each game.
- Real generated office document and correct viewer opening; mocks cannot prove OS-visible output.
- Real learning, saved-skill reuse and interruption against a game save.
- Login, billing and payment were not exercised or modified.
- Formal release still needs a user-authorized integrated Git revision. The old release pin is intentionally not silently replaced by dirty source.
