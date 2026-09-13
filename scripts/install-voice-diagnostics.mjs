// Install only explicitly prepared, hash-checked diagnostic files. No full plugin replacement.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const roots = process.argv.slice(2).map(path => resolve(path))
if (roots.length === 0) throw new Error('Explicit prepared directories required')
const running = execFileSync('powershell.exe', ['-NoProfile', '-Command', "@(Get-Process -Name 'AI Native Game Harness*' -ErrorAction SilentlyContinue).Count"], { encoding: 'utf8', windowsHide: true }).trim()
if (running !== '0') throw new Error('Exit Harness normally before installation')
const allowed = new Set(['runtime/diagnostics.js', 'runtime/error-diagnostics.js', 'runtime/agent/game-agent-session.js', 'runtime/speech/speech-controller.js', 'runtime/media/windows-media-host.js', 'gateway/game-gateway.js', 'runtime/agent/session-ownership.js'])
const hash = path => existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null
const plans = roots.map(root => {
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
  if (!manifest.prepared || ![6, 7].includes(Object.keys(manifest.hashes).length)) throw new Error('Invalid manifest')
  const target = resolve(manifest.installed)
  if (!target.endsWith('dsh-xiaotangyuan-game\\dist') && !target.endsWith('dsh-xiaotangyuan-game/dist')) throw new Error('Invalid plugin target')
  for (const file of Object.keys(manifest.hashes)) {
    if (!allowed.has(file)) throw new Error('Unexpected target file')
    if (hash(join(target, file)) !== manifest.hashes[file]) throw new Error(`Installed file changed since preparation: ${file}`)
    if (hash(join(root, 'stage', file)) !== manifest.stagedHashes[file]) throw new Error(`Staged file changed: ${file}`)
    execFileSync(process.execPath, ['--check', join(root, 'stage', file)])
  }
  return { root, target, manifest }
})
mkdirSync(join(repo, '.artifacts'), { recursive: true })
const backup = mkdtempSync(join(repo, '.artifacts', 'voice-diagnostics-'))
// Back up every original before making any installation changes.
for (const [index, plan] of plans.entries()) {
  for (const file of Object.keys(plan.manifest.hashes)) {
    const saved = join(backup, String(index), file)
    mkdirSync(dirname(saved), { recursive: true })
    if (existsSync(join(plan.target, file))) copyFileSync(join(plan.target, file), saved)
  }
}
writeFileSync(join(backup, 'manifest.json'), JSON.stringify(plans, null, 2))
const written = []
try {
  for (const [index, plan] of plans.entries()) {
    for (const file of Object.keys(plan.manifest.hashes)) {
      written.push({ index, target: join(plan.target, file), file })
      copyFileSync(join(plan.root, 'stage', file), join(plan.target, file))
      if (hash(join(plan.target, file)) !== plan.manifest.stagedHashes[file]) throw new Error(`Post-copy verification failed: ${file}`)
    }
  }
} catch (error) {
  for (const item of written.reverse()) {
    const original = join(backup, String(item.index), item.file)
    if (existsSync(original)) copyFileSync(original, item.target)
    else if (existsSync(item.target)) renameSync(item.target, `${item.target}.failed-${Date.now()}`)
  }
  throw error
}
console.log(JSON.stringify({ installed: true, targets: plans.map(plan => plan.target), backup, filesPerTarget: allowed.size }))
