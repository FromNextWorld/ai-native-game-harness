import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { stageGameUiPlugin } from '../src/game-ui-staging.mjs'

const root = fileURLToPath(new URL('../src/game-ui-plugin/', import.meta.url))
const source = readFileSync(join(root, 'client.js'), 'utf8')
test('DSH client manifest and lazy module identity agree', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  let module
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load(value) { module = value } } } })
  assert.equal(module.id, manifest.name)
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'))
})
test('native settings sections preserve explicit navigation and clean up styles', () => {
  let module, style, dispose
  const rows = []
  const document = { createElement() { return style = { dataset: {}, remove() { this.removed = true } } }, head: { append() {} } }
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load(value) { module = value } } }, document })
  const React = { createElement: (type, props, ...children) => ({ type, props, children }) }
  const plugin = module.factory(id => { assert.equal(id, 'react'); return React })
  plugin.apply({ on(event, fn) { assert.equal(event, 'dispose'); dispose = fn }, slots: {
    inject(name, fn) { assert.equal(name, 'settings.section'); fn() },
    register(options, component) { rows.push({ options, tree: component() }) },
  } })
  assert.deepEqual(rows.map(row => row.options.id), ['agh-game', 'agh-developer'])
  const trees = JSON.stringify(rows)
  assert.match(trees, /ai-native-game-harness:\/\/game/)
  assert.match(trees, /ai-native-game-harness:\/\/evaluation/)
  assert.match(trees, /agh-game-test-settings/)
  assert.doesNotMatch(style.textContent, /position\s*:\s*fixed|z-index/)
  dispose()
  assert.equal(style.removed, true)
})
test('stage discoverable package outside asar and update it without duplicates', () => {
  const state = mkdtempSync(join(tmpdir(), 'agh-ui-'))
  try {
    const patch = stageGameUiPlugin(root, state)
    assert.equal(stageGameUiPlugin(root, state), patch)
    assert.equal((patch.match(/id: agh-desktop-game-ui/g) || []).length, 1)
    assert.match(patch, /name: '@ai-native-game-harness\/desktop-game-ui'/)
    assert.equal(readFileSync(join(state, 'node_modules/@ai-native-game-harness/desktop-game-ui/client.js'), 'utf8'), source)
  } finally { rmSync(state, { recursive: true }) }
})
test('Desktop no longer creates floating navigation; composition anchors retained', () => {
  const main = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(main, /position: 'fixed'|const makeEntry/)
  assert.match(main, /await installGamePageEntry\(\)/)
  assert.match(main, /stageGameUiPlugin\(join\(desktopRoot, 'src', 'game-ui-plugin'\), app.getPath\('userData'\)\)/)
  assert.match(main, /label: '游戏', accelerator: 'CmdOrCtrl\+2'/)
})

test('separate installed Runtime loader and profile discovery both resolve the UI package', () => {
  const temp = mkdtempSync(join(tmpdir(), 'agh-ui-runtime-'))
  try {
    const profile = join(temp, 'user-data')
    const runtime = join(temp, 'installed', 'resources', 'runtime')
    const hostRequire = createRequire(join(runtime, 'node_modules', 'cordis-loader', 'index.js'))
    const profileRequire = createRequire(join(profile, 'dsh-home', 'profiles', 'web', 'package.json'))
    stageGameUiPlugin(root, profile)
    assert.ok(profileRequire.resolve('@ai-native-game-harness/desktop-game-ui/package.json'))
    assert.throws(() => hostRequire.resolve('@ai-native-game-harness/desktop-game-ui'), { code: 'MODULE_NOT_FOUND' })
    stageGameUiPlugin(root, runtime)
    assert.equal(hostRequire.resolve('@ai-native-game-harness/desktop-game-ui'), join(runtime, 'node_modules', '@ai-native-game-harness', 'desktop-game-ui', 'index.mjs'))
    const prepare = readFileSync(new URL('../../../scripts/prepare-desktop-runtime.ps1', import.meta.url), 'utf8')
    assert.match(prepare, /stageGameUiPlugin\(process.argv\[2\], process.argv\[3\]\)/)
  } finally { rmSync(temp, { recursive: true }) }
})
