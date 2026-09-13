import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, mkdtempSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
export function treeHashes(root, prefix = '') {
  return Object.fromEntries(readdirSync(join(root, prefix), { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e => {
    assert(!e.isSymbolicLink(), `Payload contains an untracked link: ${e.name}`)
    const p = prefix + e.name
    return e.isDirectory() ? Object.entries(treeHashes(root, p + '/')) : [[p, sha256(readFileSync(join(root, p)))]]
  }))
}
export function assertSameTree(root, expected) { assert.deepEqual(treeHashes(root), expected, `Payload changed: ${root}`) }
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const recordPath = join(repo, '.artifacts/source-release.json')
function sourceHashes() {
  const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: repo, encoding: 'utf8', maxBuffer: 20e6 }).split('\0').filter(Boolean)
  return Object.fromEntries([...new Set(paths)].sort().filter(p => !p.startsWith('docs/') && !p.startsWith('.github/') && !p.endsWith('.md')).map(p => {
    assert(existsSync(join(repo, p)), `Deleted source needs explicit reconciliation: ${p}`)
    return [p, sha256(readFileSync(join(repo, p)))]
  }))
}
function assertSources(m) {
  const current = sourceHashes()
  const changed = [...new Set([...Object.keys(current), ...Object.keys(m.sources)])].filter(p => current[p] !== m.sources[p])
  assert.equal(changed.length, 0, `Source changed after capture. Rebuild before packaging: ${changed.slice(0, 12).join(', ')}`)
}
export function verifyRelease() {
  const m = JSON.parse(readFileSync(recordPath))
  assert(m.sourceBuilt && m.sealedAt, 'No sealed source build. Run pnpm desktop:prepare first.')
  assertSources(m)
  for (const [p, hashes] of Object.entries(m.payloads)) assertSameTree(join(repo, p), hashes)
  for (const [p, hash] of Object.entries(m.archives)) assert.equal(sha256(readFileSync(join(repo, p))), hash, `Archive changed: ${p}`)
  return m.sourceId
}
function run(mode) {
  mkdirSync(dirname(recordPath), { recursive: true })
  if (mode === 'capture') {
    const sources = sourceHashes()
    const m = { schemaVersion: 1, sourceId: sha256(JSON.stringify(sources)), sources, sourceBuilt: false, capturedAt: new Date().toISOString() }
    writeFileSync(recordPath, JSON.stringify(m, null, 2))
    console.log(JSON.stringify({ captured: m.sourceId })); return
  }
  if (mode === 'verify') { console.log(JSON.stringify({ verified: verifyRelease() })); return }
  assert.equal(mode, 'seal', 'Use capture, seal, or verify')
  const m = JSON.parse(readFileSync(recordPath)); assertSources(m)
  const payloads = {}, archives = {}
  const gameUiRuntime = '.artifacts/desktop-runtime/node_modules/@ai-native-game-harness/desktop-game-ui'
  const gameUiHashes = treeHashes(join(repo, 'apps/desktop/src/game-ui-plugin'))
  assertSameTree(join(repo, gameUiRuntime), gameUiHashes)
  payloads[gameUiRuntime] = gameUiHashes
  const specs = ['plugins/dsh-work-orchestrator', 'plugins/xiaotangyuan-game', 'games/oxygen-not-included/adapter']
  for (const p of specs) {
    const metadata = JSON.parse(readFileSync(join(repo, p, 'package.json')))
    const archive = `.artifacts/xiaotangyuan/${metadata.name.replace('@','').replace('/','-')}-${metadata.version}.tgz`
    const unpack = mkdtempSync(join(repo, '.artifacts/release-archive-'))
    execFileSync('tar.exe', ['-xzf', join(repo, archive), '-C', unpack])
    const hashes = treeHashes(join(repo, p, 'dist'))
    assertSameTree(join(unpack, 'package/dist'), hashes)
    const runtime = `.artifacts/desktop-runtime/node_modules/${metadata.name}/dist`
    assertSameTree(join(repo, runtime), hashes)
    payloads[`${p}/dist`] = hashes; payloads[runtime] = hashes
    archives[archive] = sha256(readFileSync(join(repo, archive)))
  }
  for (const p of ['.artifacts/desktop-app/src', '.artifacts/dst-package']) {
    // DST staging contains transient build directories; seal only packaged entrypoints below.
    if (p.endsWith('dst-package')) {
      const bundle = JSON.parse(readFileSync(join(repo, p, 'bundle.json')))
      for (const f of ['bundle.json', bundle.archive]) archives[`${p}/${f}`] = sha256(readFileSync(join(repo,p,f)))
    } else payloads[p] = treeHashes(join(repo, p))
  }
  Object.assign(m, { payloads, archives, sourceBuilt: true, sealedAt: new Date().toISOString() })
  writeFileSync(recordPath, JSON.stringify(m, null, 2))
  console.log(JSON.stringify({ sealed: verifyRelease(), pluginPayloads: specs.length }))
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run(process.argv[2])
