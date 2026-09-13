import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import ts from 'typescript'
import { beforeAll, describe, expect, it } from 'vitest'

let root: string
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'agh-speech-process-'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }))
  // Emit actual production code into an isolated Node process. No behavior
  // replacement and no global unhandledRejection listener.
  for (const relative of ['runtime/speech/speech-controller', 'runtime/speech/provider-check-deadline', 'runtime/media/windows-media-host', 'runtime/capabilities', 'runtime/diagnostics', 'runtime/error-diagnostics']) {
    const source = relative === 'runtime/speech/speech-controller' && process.env.AGH_SPEECH_BASELINE
      ? process.env.AGH_SPEECH_BASELINE : new URL('../src/' + relative + '.ts', import.meta.url)
    const target = join(root, relative + '.js')
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, ts.transpileModule(readFileSync(source, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText)
  }
})
describe('media JSON -> speech queues under real Node strict rejection policy', () => {
  it.each(['synthesis', 'caption', 'close', 'provider-failure', 'partial-failure'])('survives %s before model finalization and preserves the next recording', scenario => {
    const result = spawnSync(process.execPath, ['--unhandled-rejections=strict', fileURLToPath(new URL('./fixtures/speech-process-cancellation.mjs', import.meta.url))], {
      env: { ...process.env, AGH_SPEECH_TEST_ROOT: root, AGH_SPEECH_TEST_SCENARIO: scenario, DSH_HOME: join(root, scenario) }, encoding: 'utf8', timeout: 10000,
    })
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('"survived":true')
  })
})
