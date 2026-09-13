import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
assert(root.endsWith('source-unified-20260909'))
assert(!existsSync(join(root, '.artifacts')) || !readdirSync(join(root, '.artifacts')).some(name => name.startsWith('source-assembly-')), 'Assembly already ran; refusing to overwrite reviewed integration changes.')
const sources = ['player-help-20260907', 'voice-diagnostics-20260909'].map(x => resolve(root, '..', x))
const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { maxBuffer: 40 * 1024 * 1024 })
const base = git(root, ['rev-parse', 'HEAD']).toString().trim()
for (const source of sources) assert.equal(git(source, ['rev-parse', 'HEAD']).toString().trim(), base)
const lists = sources.map(s => new Set([...git(s, ['diff', '--name-only', '-z']).toString().split('\0'), ...git(s, ['ls-files', '--others', '--exclude-standard', '-z']).toString().split('\0')].filter(p => p && !p.startsWith('docs/coordination/claims/'))))
mkdirSync(join(root, '.artifacts'), { recursive: true })
const stage = mkdtempSync(join(root, '.artifacts/source-assembly-'))
const records = [], conflicts = []
const hash = b => createHash('sha256').update(b).digest('hex')
for (const p of new Set([...lists[0], ...lists[1]])) {
  assert(!/(^|\/)(?:node_modules|\.env|dist|bin|obj|\.artifacts)(\/|$)/.test(p), `Unexpected source file ${p}`)
  const versions = sources.map((s, i) => lists[i].has(p) && existsSync(join(s, p)) ? readFileSync(join(s, p)) : null)
  assert(versions.some(Boolean), `Deletion needs review: ${p}`)
  let original = null
  try { original = git(root, ['show', `${base}:${p}`]) } catch {}
  for (let i = 0; i < versions.length; i++) if (!lists[i].has(p)) versions[i] = original
  const folder = join(stage, String(records.length)); mkdirSync(folder)
  for (const [i, b] of versions.entries()) if (b) writeFileSync(join(folder, `source-${i}`), b)
  if (original) writeFileSync(join(folder, 'base'), original)
  let result
  if (!lists[1].has(p)) result = versions[0]
  else if (!lists[0].has(p) || versions[0]?.equals(versions[1])) result = versions[1]
  else if (!original || versions.some(b => b?.includes(0))) conflicts.push(p)
  else {
    for (const [n, b] of [['ours', versions[0]], ['base-text', original], ['theirs', versions[1]]]) writeFileSync(join(folder, n), b.toString().replaceAll('\r\n', '\n'))
    const merge = spawnSync('git', ['merge-file', '-p', join(folder, 'ours'), join(folder, 'base-text'), join(folder, 'theirs')], { maxBuffer: 20 * 1024 * 1024 })
    if (merge.status === 0) result = merge.stdout
    else { conflicts.push(p); writeFileSync(join(folder, 'conflict.txt'), merge.stdout) }
  }
  const dest = join(root, p)
  if (result) { mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, result) }
  records.push({ path: p, sourceHashes: versions.map(b => b && hash(b)), outputHash: result ? hash(result) : null, folder })
}
writeFileSync(join(stage, 'manifest.json'), JSON.stringify({ base, sources, records, conflicts }, null, 2))
console.log(JSON.stringify({ stage, copied: records.length - conflicts.length, conflicts }))
