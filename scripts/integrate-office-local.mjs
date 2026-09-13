// Local hot-update only. This is NOT a source-built public release.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, mkdtempSync, cpSync, copyFileSync, renameSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const resources = 'C:/Users/10354/AppData/Local/Programs/AI Native Game Harness/resources'
const data = 'C:/Users/10354/AppData/Roaming/AI Native Game Harness 商业版'
const bases = ['dsh-home', 'dsh-home-self-hosted'].map(x => join(data, x, 'profiles/web/node_modules'))
bases.push(join(resources, 'runtime/node_modules'))
const names = ['dsh-work-orchestrator', 'dsh-xiaotangyuan-game']
const packageRoot = (base, name) => join(base, '@qimidandapigu', name)
const hash = p => existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : null
function files(root, prefix = '') {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap(e => {
    assert(!e.isSymbolicLink(), `Unexpected link in package payload: ${e.name}`)
    return e.isDirectory() ? files(root, prefix + e.name + '/') : [prefix + e.name]
  })
}
const inventory = root => Object.fromEntries(files(root).map(f => [f, hash(join(root, f))]))
function closed() {
  const p = execFileSync('powershell.exe', ['-NoProfile', '-Command', "@(Get-CimInstance Win32_Process | Where-Object { $_.Name -like '*Harness*' -or $_.Name -like '*Stardew*' -or ($_.Name -eq 'node.exe' -and $_.CommandLine -match 'AI Native Game Harness.*(resources|dsh-home)') } | Select-Object -ExpandProperty ProcessId) | ConvertTo-Json -Compress"], { encoding: 'utf8', windowsHide: true }).trim()
  assert(!p || p === '[]', `Exit application/game normally first. Running PIDs: ${p}`)
}
const save = (p, value) => writeFileSync(p, JSON.stringify(value, null, 2))
async function probe(base, scratch) {
  const load = (n, f) => import(pathToFileURL(join(packageRoot(base, n), 'dist', f)))
  // Import full plugin entries as well, proving dependencies resolve in each profile.
  for (const name of names) await load(name, 'index.js')
  const w = await load(names[0], 'work-orchestrator-service.js')
  const e = await load(names[0], 'work-evidence.js')
  const file = join(scratch, 'final.html')
  writeFileSync(file, '<!doctype html><html><body>Final artifact</body></html>')
  const receipt = command => [
    { seq: 0, type: 'tool/call', data: { callId: 'p', name: 'pwsh', arguments: JSON.stringify({ command }) } },
    { seq: 1, type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: 'p', isError: false }] } } },
  ]
  const instruction = w.workVerificationInstruction('打开最终成果', '联网查资料并生成 HTML')
  assert.equal(w.requiresArtifactWrite(instruction), false)
  assert.equal(w.requiresWebResearch(instruction), false)
  assert(w.verifyWorkExecution(receipt(`Start-Process '${file}'`), 0, scratch, instruction, e.captureWorkFiles(scratch)).opened)
  assert.throws(() => w.verifyWorkExecution(receipt("Write-Output 'Invoke-WebRequest'"), 0, scratch, '联网查资料'))
  assert.throws(() => w.verifyWorkExecution(receipt("# Invoke-WebRequest 'https://example.invalid'"), 0, scratch, '联网查资料'))
  assert.equal(typeof (await load(names[0], 'work-game-context.js')).registerWorkGameContextTool, 'function')
  const { registerSkillTools } = await load(names[1], 'tools/skill-tools.js')
  const tools = [], calls = []
  const atoms = ['create', 'formation', 'launch', 'status', 'cancel'].map(x => 'stardew.projectiles_' + x)
  registerSkillTools({ on() {}, tools: { register: t => tools.push(t) } }, { gameId: 'stardew-valley', capabilities: atoms },
    { store: { list: () => [] }, tryLearnSource() { throw Error('Must not learn a built-in ability') } },
    async (atom, args) => { calls.push(atom); return atom.endsWith('_cancel') ? { state: 'canceled', remaining: 0 } : { opId: args.opId, count: args.count, preview: args.preview, state: 'orbit', remaining: args.count, hits: 0, damage: 0, kills: 0, reason: '' } })
  for (const n of ['xiaotangyuan_sword_formation', 'xiaotangyuan_sword_formation_stop', 'xiaotangyuan_grandpa_water', 'xiaotangyuan_skill_learn']) assert(tools.some(t => t.name === n), n)
  assert((await tools.find(t => t.name === 'xiaotangyuan_sword_formation').execute({ mode: 'summon' }, { signal: AbortSignal.timeout(3000) })).success)
  await tools.find(t => t.name === 'xiaotangyuan_sword_formation_stop').execute({}, { signal: AbortSignal.timeout(3000) })
  assert.deepEqual(calls, ['stardew.projectiles_create', 'stardew.projectiles_cancel'])
  return { base, imports: true, officeFollowup: true, researchEvidence: true, gameContext: true, builtinAbilities: true, realGameActions: 0, paidCalls: 0 }
}
const [mode = 'prepare', directory] = process.argv.slice(2)
if (mode === 'prepare') {
  closed()
  mkdirSync(join(repo, '.artifacts'), { recursive: true })
  const stage = mkdtempSync(join(repo, '.artifacts/office-integration-'))
  const targets = [], packages = []
  for (const name of names) {
    const original = packageRoot(bases[0], name), pkg = join(stage, name, 'package')
    mkdirSync(pkg, { recursive: true })
    const metadata = JSON.parse(readFileSync(join(original, 'package.json')))
    for (const base of bases) {
      const m = JSON.parse(readFileSync(join(packageRoot(base, name), 'package.json')))
      for (const field of ['version', 'dependencies', 'peerDependencies']) assert.deepEqual(m[field], metadata[field], `${name} incompatible ${field}`)
    }
    assert.deepEqual(inventory(join(original, 'dist')), inventory(join(packageRoot(bases[2], name), 'dist')), 'Official and Runtime baseline differ')
    for (const entry of readdirSync(original)) if (entry !== 'node_modules') cpSync(join(original, entry), join(pkg, entry), { recursive: true, dereference: true })
    if (name === names[0]) {
      const built = join(repo, 'plugins/dsh-work-orchestrator/dist')
      // Only these modules changed. Retain all unrelated installed modules.
      for (const module of ['work-evidence', 'work-orchestrator-service']) for (const suffix of ['.js', '.js.map', '.d.ts']) copyFileSync(join(built, module + suffix), join(pkg, 'dist', module + suffix))
      const source = join(stage, 'work-source'); mkdirSync(source)
      for (const part of ['src', 'test', 'package.json', 'tsconfig.json']) cpSync(join(repo, 'plugins/dsh-work-orchestrator', part), join(source, part), { recursive: true })
      save(join(source, 'hashes.json'), inventory(source))
    }
    const payload = files(join(pkg, 'dist'))
    for (const base of bases) {
      const dest = packageRoot(base, name)
      for (const rel of files(join(dest, 'dist'))) assert(payload.includes(rel), `Unreviewed extra installed file: ${rel}`)
      for (const rel of payload) {
        const source = join(pkg, 'dist', rel), destination = join(dest, 'dist', rel)
        if (hash(source) !== hash(destination)) targets.push({ source, destination, before: hash(destination), after: hash(source) })
      }
    }
    const archive = join(stage, `${name}.tgz`)
    execFileSync('tar.exe', ['-czf', archive, '-C', dirname(pkg), 'package'])
    const archiveCheck = join(stage, `${name}-archive`); mkdirSync(archiveCheck)
    execFileSync('tar.exe', ['-xzf', archive, '-C', archiveCheck])
    assert.deepEqual(inventory(pkg), inventory(join(archiveCheck, 'package')), 'Archive roundtrip failed')
    const destination = join(resources, 'plugins', `qimidandapigu-${name}-${metadata.version}.tgz`)
    targets.push({ source: archive, destination, before: hash(destination), after: hash(archive) })
    packages.push({ name, pkg, hashes: inventory(join(pkg, 'dist')) })
  }
  const manifest = { stage, targets, packages, createdAt: new Date().toISOString(), coreHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), sourceBuiltRelease: false, releaseBlocker: 'Game plugin retains reviewed installed composite. Full source reconciliation and pinned release authorization still required.', appAsar: hash(join(resources, 'app.asar')) }
  save(join(stage, 'manifest.json'), manifest)
  console.log(JSON.stringify({ stage, changedFiles: targets.length, sourceBuiltRelease: false }))
} else if (mode === 'install' || mode === 'verify') {
  assert(directory, 'Explicit prepared directory required')
  const stage = resolve(directory), m = JSON.parse(readFileSync(join(stage, 'manifest.json')))
  assert.equal(resolve(m.stage), stage)
  const within = (p, root) => resolve(p).toLowerCase().startsWith(resolve(root).toLowerCase() + '\\')
  assert(within(stage, join(repo, '.artifacts')))
  if (mode === 'install') {
    closed()
    for (const t of m.targets) {
      assert(within(t.source, stage))
      assert(names.some(n => bases.some(b => within(t.destination, join(packageRoot(b, n), 'dist')))) || (dirname(t.destination) === join(resources, 'plugins') && /^qimidandapigu-dsh-(work-orchestrator|xiaotangyuan-game)-[\d.]+\.tgz$/.test(t.destination.split(/[\\/]/).at(-1))))
      assert.equal(hash(t.source), t.after, 'Stage changed'); assert.equal(hash(t.destination), t.before, 'Installed files changed')
    }
    const backup = join(stage, 'backup'); assert(!existsSync(backup)); mkdirSync(backup)
    for (const [i, t] of m.targets.entries()) if (t.before !== null) copyFileSync(t.destination, join(backup, String(i)))
    const changed = []
    try {
      closed()
      for (const [i, t] of m.targets.entries()) {
        assert.equal(hash(t.destination), t.before)
        mkdirSync(dirname(t.destination), { recursive: true })
        const temp = t.destination + '.office-update-tmp'; assert(!existsSync(temp))
        copyFileSync(t.source, temp); renameSync(temp, t.destination); changed.push(i)
        assert.equal(hash(t.destination), t.after)
      }
      // Fresh subprocess; any verification failure rolls back the entire batch.
      execFileSync(process.execPath, [fileURLToPath(import.meta.url), 'verify', stage], { stdio: 'inherit' })
      save(join(stage, 'installed.json'), { at: new Date().toISOString(), changedFiles: changed.length, backup })
    } catch (error) {
      for (const i of changed.reverse()) {
        const t = m.targets[i]
        if (t.before !== null) copyFileSync(join(backup, String(i)), t.destination)
        else renameSync(t.destination, join(backup, `${i}-rolled-back-new`))
      }
      throw error
    }
  } else {
    assert.equal(hash(join(resources, 'app.asar')), m.appAsar, 'Desktop shell changed')
    for (const t of m.targets) assert.equal(hash(t.destination), t.after)
    for (const p of m.packages) for (const base of bases) assert.deepEqual(inventory(join(packageRoot(base, p.name), 'dist')), p.hashes)
    const scratch = mkdtempSync(join(stage, 'probe-')), proofs = []
    process.env.DSH_HOME = scratch
    for (const base of bases) proofs.push(await probe(base, scratch))
    save(join(stage, 'verification.json'), { at: new Date().toISOString(), proofs, recoveryArchivesMatch: true })
    console.log(JSON.stringify({ passed: true, profilesAndRuntime: proofs.length, proofs }))
  }
} else throw Error('Use prepare, install <stage>, verify <stage>')
