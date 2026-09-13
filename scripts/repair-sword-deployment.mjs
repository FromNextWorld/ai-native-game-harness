// Scoped compatibility repair. Never overwrite the installed newer skill-learning implementation.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, mkdtempSync, cpSync, copyFileSync, renameSync, realpathSync, symlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const roots = [
  'C:/Users/10354/AppData/Roaming/AI Native Game Harness 商业版/dsh-home/profiles/web/node_modules/@qimidandapigu/dsh-xiaotangyuan-game/dist',
  'C:/Users/10354/AppData/Local/Programs/AI Native Game Harness/resources/runtime/node_modules/@qimidandapigu/dsh-xiaotangyuan-game/dist',
]
const files = ['tools/skill-tools.js', 'tools/sword-formation-tools.js', 'runtime/tasks/sword-formation.js', 'gateway/game-gateway.js', 'runtime/agent/game-agent-session.js']
const hash = p => existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : null
function snapshot(root, prefix = '') {
  const result = {}
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const rel = prefix + entry.name
    if (entry.isDirectory()) Object.assign(result, snapshot(root, rel + '/'))
    else if (rel.endsWith('.js')) result[rel] = hash(join(root, rel))
  }
  return result
}
function replaceOnce(text, from, to) {
  assert.equal(text.split(from).length, 2, `Compatibility anchor changed: ${from}`)
  return text.replace(from, to)
}
async function probe(root) {
  const { registerSkillTools } = await import(pathToFileURL(join(root, 'tools/skill-tools.js')))
  const atoms = ['create', 'formation', 'launch', 'status', 'cancel'].map(x => `stardew.projectiles_${x}`)
  const tools = [], calls = []
  const ctx = { on() {}, tools: { register(t) { tools.push(t) } } }
  const skills = { store: { list: () => [] }, tryLearnSource() { throw Error('Must not learn built-in sword') } }
  registerSkillTools(ctx, { gameId: 'stardew-valley', capabilities: atoms }, skills, async (atom, args) => {
    calls.push(atom)
    if (atom.endsWith('_cancel')) return { state: 'canceled', remaining: 0 }
    return { opId: args.opId, count: args.count, preview: args.preview, state: 'orbit', remaining: args.count, hits: 0, damage: 0, kills: 0, reason: '' }
  })
  for (const name of ['xiaotangyuan_sword_formation', 'xiaotangyuan_sword_formation_stop', 'xiaotangyuan_grandpa_water', 'xiaotangyuan_skill_learn']) assert(tools.some(t => t.name === name), `Missing ${name}`)
  assert(!tools.find(t => t.name === 'xiaotangyuan_skill_run').description.includes('必须先通过学习'))
  const result = await tools.find(t => t.name === 'xiaotangyuan_sword_formation').execute({ mode: 'summon' }, { signal: AbortSignal.timeout(5000) })
  assert.equal(result.success, true)
  await tools.find(t => t.name === 'xiaotangyuan_sword_formation_stop').execute({}, { signal: AbortSignal.timeout(5000) })
  assert.deepEqual(calls, ['stardew.projectiles_create', 'stardew.projectiles_cancel'])
  return { registered: tools.map(t => t.name), simulatedAtoms: calls, realGameActions: 0 }
}
function requireClosed() {
  const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', "@(Get-CimInstance Win32_Process | Where-Object { $_.Name -like '*Harness*' -or ($_.Name -eq 'node.exe' -and $_.CommandLine -match 'AI Native Game Harness.*(resources|dsh-home)') } | Select-Object -ExpandProperty ProcessId) | ConvertTo-Json -Compress"], { encoding: 'utf8' }).trim()
  assert(!output || output === '[]', `Harness runtime is running (PIDs ${output}); exit normally first`)
}
const [mode = 'prepare', directory] = process.argv.slice(2)
if (mode === 'prepare') {
  const before = roots.map(root => snapshot(root))
  for (const rel of new Set([...Object.keys(before[0]), ...Object.keys(before[1])])) {
    if (before[0][rel] !== before[1][rel]) assert(files.includes(rel), `Unreviewed deployment difference: ${rel}`)
  }
  const artifacts = join(repo, '.artifacts'); mkdirSync(artifacts, { recursive: true })
  const stage = mkdtempSync(join(artifacts, 'sword-deployment-'))
  cpSync(roots[0], join(stage, 'dist'), { recursive: true })
  symlinkSync(dirname(dirname(dirname(realpathSync(roots[0])))), join(stage, 'node_modules'), 'junction')
  for (const rel of files.slice(1, 3)) {
    copyFileSync(join(repo, 'plugins/xiaotangyuan-game/dist', rel), join(stage, 'dist', rel))
    for (const ext of ['.map']) if (existsSync(join(repo, 'plugins/xiaotangyuan-game/dist', rel + ext))) copyFileSync(join(repo, 'plugins/xiaotangyuan-game/dist', rel + ext), join(stage, 'dist', rel + ext))
  }
  const path = join(stage, 'dist/tools/skill-tools.js')
  let text = readFileSync(path, 'utf8')
  if (!text.includes('已有专用工具的能力直接调用专用工具')) text = replaceOnce(text, '玩家要求实际行动时必须调用；', '已有专用工具的能力直接调用专用工具，不需要重新学习；')
  if (!text.includes('暂无已学习技能；这不影响已有专用工具的使用')) text = replaceOnce(text, '暂无，必须先通过学习工具实际试跑', '暂无已学习技能；这不影响已有专用工具的使用')
  writeFileSync(path, text)
  const agentPath = join(stage, 'dist/runtime/agent/game-agent-session.js')
  let agent = readFileSync(agentPath, 'utf8')
  const policy = '玩家要求执行游戏动作不是角色扮演。除明确声明交给回答后动作阶段的能力外，必须实际调用本轮提供的对应游戏工具，不能仅用文字描述动作。优先使用现成专用工具；专用工具不依赖已学习技能列表，列表为空也不必新建技能。没有工具调用及明确成功回执就不能说已召唤、已完成或已收回。'
  const anchor = "        'Do not use Markdown. Never claim a game action succeeded unless a game tool returned an explicit successful result in this turn.',"
  if (!agent.includes(policy)) agent = replaceOnce(agent, anchor, anchor + '\n        ' + JSON.stringify(policy) + ',')
  writeFileSync(agentPath, agent)
  const gatewayPath = join(stage, 'dist/gateway/game-gateway.js')
  let gateway = readFileSync(gatewayPath, 'utf8')
  const chatAnchor = '                const chat = readGameChat(request.params);'
  if (!gateway.includes('isSwordRecall(chat.text)')) gateway = replaceOnce(gateway, chatAnchor, chatAnchor + `
                if (state.adapter?.gameId === 'stardew-valley' && isSwordRecall(chat.text)) {
                    state.postReplyAction?.abort(new Error('玩家收回剑阵'));
                    state.session.cancel();
                    const interactionId = randomUUID();
                    const value = await this.callAdapterAtom(state, 'stardew.projectiles_cancel', {}, AbortSignal.timeout(3000));
                    const confirmed = value?.remaining === 0 && ['idle', 'canceled', 'completed', 'expired', 'failed'].includes(value.state ?? '');
                    const reply = confirmed ? (/爷爷|浇地/.test(chat.text) ? '爷爷已经停下，回去了。' : '崽崽剑阵已收回。') : '还没有收到收回确认，请再说一次停止命令。';
                    this.finishTextStream(state, interactionId, reply, 'chat');
                    return { reply, sessionId: persistentGameSessionId(state.adapter, state.latestSaveId), interactionId };
                }`)
  writeFileSync(gatewayPath, gateway)
  for (const rel of files) execFileSync(process.execPath, ['--check', join(stage, 'dist', rel)])
  const proof = await probe(join(stage, 'dist'))
  const manifest = { roots, files, before, after: snapshot(join(stage, 'dist')), proof, createdAt: new Date().toISOString() }
  writeFileSync(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(JSON.stringify({ prepared: stage, proof }))
} else if (mode === 'install') {
  assert(directory, 'Explicit prepared directory required')
  const stage = realpathSync(directory), manifest = JSON.parse(readFileSync(join(stage, 'manifest.json'), 'utf8'))
  assert.deepEqual(manifest.roots, roots); assert.deepEqual(manifest.files, files)
  requireClosed()
  roots.forEach((root, i) => assert.deepEqual(snapshot(root), manifest.before[i], 'Installed tree changed since preparation'))
  assert.deepEqual(snapshot(join(stage, 'dist')), manifest.after, 'Prepared tree changed')
  await probe(join(stage, 'dist'))
  const backup = join(stage, 'backup'); assert(!existsSync(backup), 'Stage already used; prepare a fresh stage')
  mkdirSync(backup)
  for (let i = 0; i < roots.length; i++) for (const rel of files) {
    const target = join(roots[i], rel), dest = join(backup, String(i), rel)
    mkdirSync(dirname(dest), { recursive: true })
    if (existsSync(target)) copyFileSync(target, dest)
  }
  const changed = []
  try {
    requireClosed()
    for (let i = 0; i < roots.length; i++) for (const rel of files) {
      const target = join(roots[i], rel)
      assert.equal(hash(target), manifest.before[i][rel] ?? null)
      mkdirSync(dirname(target), { recursive: true })
      const temp = target + '.sword-repair-tmp'
      assert(!existsSync(temp)); copyFileSync(join(stage, 'dist', rel), temp)
      renameSync(temp, target); changed.push({ i, rel })
      assert.equal(hash(target), manifest.after[rel])
    }
    roots.forEach(root => assert.deepEqual(snapshot(root), manifest.after, 'Whole JS tree differs'))
    const proofs = []
    for (const root of roots) proofs.push(await probe(root))
    writeFileSync(join(stage, 'installed.json'), JSON.stringify({ installedAt: new Date().toISOString(), proofs }, null, 2))
    console.log(JSON.stringify({ installed: true, jsFilesPerRoot: Object.keys(manifest.after).length, backup, proofs }))
  } catch (error) {
    for (const { i, rel } of changed.reverse()) {
      const original = join(backup, String(i), rel), target = join(roots[i], rel)
      if (existsSync(original)) copyFileSync(original, target)
      else renameSync(target, original + '.rolled-back-new')
    }
    throw error
  }
} else if (mode === 'verify') {
  assert.deepEqual(snapshot(roots[0]), snapshot(roots[1]), 'Profile and Runtime JS differ')
  for (const root of roots) console.log(JSON.stringify({ root, proof: await probe(root) }))
} else throw Error('Use prepare, install <prepared-directory>, or verify')
