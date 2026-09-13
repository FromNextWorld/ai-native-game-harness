# Onboarding and readiness follow-up

## Public change

- Speech provider selection now has a five-second deadline for startup and subsequent selection calls. ASR and TTS remain independent.
- Timeouts are reported explicitly in readiness, rather than hanging before media startup. Desktop displays a retryable timeout message.
- Closing aborts waiting immediately. Late provider resolution/rejection cannot publish success or create a media process after close.
- Legacy provider code cannot be forcibly cancelled internally; the wrapper bounds our waiting and consumes late rejection. No paid provider call or microphone recording is introduced by self-check.

## Private onboarding change

- A single owner controls each snapshot subscription, polling timer and in-flight response. Completion, closing and step replacement invalidate that owner.
- Reentrant and synchronous subscription callbacks are covered, including changing steps from inside the callback.
- Voice proof requires matching game ID, unseen trace ID and a valid timestamp from the current test. Consumed failures cannot indefinitely hide later success.
- Both onboarding UI paths use the same tested helper, packaged by the private composition. Private implementation remains outside the public repository.

## Verification

- Game check: build and 302 tests passed.
- Core integration 64 and platform 22 tests passed.
- Private check passed: JavaScript tests 55 passed, one skipped due to Windows symlink permissions. Nine new observer/voice-proof tests passed.
- Secret scan and whitespace checks passed (public Git emits line-ending warnings only).
- Full build sealed source `bd233eba25c735f6812ffc2d032f52b11bb98e948d5a7c1e695b0426ee8a8993`; real DSH with local mock model passed initial and resumed chat.
- Desktop smoke passed preload, Web, 33145, single instance, Profile isolation and zero residual processes.
- Private update stage `.artifacts/local-update-P7ZiPO`: 26 files replaced, zero stale files removed, user settings unchanged; no backup or rollback. Prepared application includes the exact tested renderer and observer module.
- Installed startup passed Web, product bridge, Gateway, ASR/TTS configured and media handshake ready. Microphone explicitly remains untested. Main process 34408 is deliberately left running for the user.
- No commits, release pin changes, cloud changes or account/save changes.

## Remaining boundary

Real microphone, real game learning, actual office viewer opening, login/payment are not proven by these mocks or startup checks.
