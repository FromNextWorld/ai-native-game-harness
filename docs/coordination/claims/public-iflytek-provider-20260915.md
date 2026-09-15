# Public iFlytek ASR provider (2026-09-15)

## Required behavior

- The public standard plugin registers an `iflytek` implementation of `speech.transcribe` beside the existing `volcengine` implementation.
- iFlytek uses user-owned DSH credential references (`IFLYTEK_APP_ID`, `IFLYTEK_API_KEY`, `IFLYTEK_API_SECRET`); no secret value is stored in source, config, logs, or diagnostics.
- `speech.recognitionProvider: iflytek` selects iFlytek ASR, while TTS remains independently selectable (and can continue using Volcengine).
- Streaming recognition sends PCM16 mono audio and reports partial/final text through the existing provider-neutral contract.

## Must not change

- Do not move commercial hosted routing, billing, account, quota, or gateway credentials into the public repository.
- Do not change the reply-first rule, audio completion boundary, cancellation semantics, Work recognition timing, game actions, or Adapter protocol.
- Do not remove or silently replace Volcengine ASR/TTS.

## Production entrypoints

- `plugins/xiaotangyuan-game/src/index.ts`: built-in capability registration.
- `plugins/xiaotangyuan-game/src/config.ts`: public credential-reference configuration.
- `plugins/xiaotangyuan-game/src/runtime/speech/iflytek-speech-provider.ts`: signed WebSocket transport.
- `plugins/xiaotangyuan-game/src/runtime/speech/speech-controller.ts`: existing provider-neutral ASR consumer (unchanged).

## Acceptance evidence

- Regression test fails on the old public implementation because `apply()` does not register `iflytek`.
- The same registration test passes after the implementation.
- Signing, streaming frame pacing, final transcript assembly, cancellation, and secret-free diagnostics are tested with a simulated upstream WebSocket while using the production transport code.
- Existing XiaoTangYuan package tests and reply-first/Work voice timing tests remain green.
- No claim of live iFlytek, installed Desktop, or in-game acceptance without user credentials and a real runtime test.
