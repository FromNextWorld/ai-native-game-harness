// Real Harness/model, synthetic Adapter only. No microphone, screenshots, real game or social publishing.
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync, readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
import assert from 'node:assert/strict'
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(repo, 'plugins/xiaotangyuan-game/package.json'))
const WebSocket = require('ws')
const ws = new WebSocket('ws://127.0.0.1:33145')
const saveId = `diagnostic-sword-${randomUUID()}`, pending = new Map(), calls = []
const atoms = ['create', 'formation', 'launch', 'status', 'cancel'].map(x => `stardew.projectiles_${x}`)
let group, unexpected = []
ws.on('message', raw => {
  const m = JSON.parse(raw.toString())
  if (m.method === 'game.atom.execute') {
    const { atom, arguments: args } = m.params
    if (!atoms.includes(atom)) {
      unexpected.push(atom)
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Synthetic test does not allow this action' } }))
      return
    }
    calls.push({ atom, arguments: args })
    if (atom.endsWith('_create')) group = { opId: args.opId, preview: args.preview, count: args.count, remaining: args.count, hits: 0, damage: 0, kills: 0, state: 'orbit', reason: '' }
    if (atom.endsWith('_formation')) group.state = 'fan'
    if (atom.endsWith('_launch')) group.state = 'launched'
    if (atom.endsWith('_status')) group = { ...group, state: 'completed', remaining: 0 }
    if (atom.endsWith('_cancel')) group = { ...group, state: 'canceled', remaining: 0 }
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: group }))
  } else if (pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer)
    if (m.error) p.reject(new Error(m.error.message))
    else p.resolve(m.result)
  }
})
function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const id = randomUUID(), timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)) }, 70_000)
    pending.set(id, { resolve, reject, timer })
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
  })
}
const proof = { saveId, realModel: true, realGameActions: 0, calls, results: [] }
try {
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
  await rpc('adapter.hello', { adapterId: 'diagnostic.sword-model', gameId: 'stardew-valley', version: 'test', protocolVersion: '1.1', saveId, capabilities: atoms })
  const roleInstructions = process.env.SWORD_POLICY_PROBE === '1' ? '玩家要求执行游戏动作不是角色扮演。必须实际调用本轮提供的对应游戏工具，不能仅用文字描述动作。优先使用现成专用工具；专用工具不依赖已学习技能列表，列表为空也不必新建技能。没有工具调用及明确成功回执就不能说已召唤、已完成或已收回。' : undefined
  const start = await rpc('chat.send', { text: '释放万剑归宗。', context: { saveId, location: 'Farm', roleInstructions } })
  proof.results.push(start)
  let compressed = readFileSync(join('C:/Users/10354/AppData/Roaming/AI Native Game Harness 商业版/dsh-home/sessions/--C-Users-10354-AppData-Roaming-AI~0020Native~0020Game~0020Harness~0020~5546~4E1A~7248--', start.sessionId, 'session.jsonl.zstd'))
  let history = ''
  while (compressed.length) {
    const frame = zstdDecompressSync(compressed, { info: true })
    history += frame.buffer.toString(); compressed = compressed.subarray(frame.engine.bytesWritten)
  }
  const events = history.trim().split('\n').map(JSON.parse)
  proof.modelToolCalls = events.filter(e => e.type === 'assistant/message').flatMap(e => e.data.message.content.filter(c => c.type === 'tool-call').map(c => c.name))
  assert(proof.modelToolCalls.includes('xiaotangyuan_sword_formation'), 'Model did not use the dedicated sword tool')
  assert(!proof.modelToolCalls.some(name => /skill_learn/.test(name)), 'Built-in action incorrectly used skill learning')
  assert(calls.some(c => c.atom === 'stardew.projectiles_create'), 'Model did not call sword create')
  assert.equal(calls[0].arguments.preview, true, 'Unqualified request should be harmless summon/preview')
  assert.equal(unexpected.length, 0)
  if (process.env.SWORD_SUMMON_ONLY !== '1') {
    const stop = await rpc('chat.send', { text: '收回剑阵。', context: { saveId, location: 'Farm', roleInstructions } })
    proof.results.push(stop)
    assert(calls.some(c => c.atom === 'stardew.projectiles_cancel'), 'Model did not call sword stop')
  }
  proof.passed = true
  console.log(JSON.stringify(proof))
} catch (error) {
  proof.passed = false; proof.error = error.message
  console.log(JSON.stringify(proof)); process.exitCode = 1
} finally {
  writeFileSync(join(repo, '.artifacts/sword-model-smoke.json'), JSON.stringify(proof, null, 2))
  writeFileSync(join(repo, `.artifacts/${saveId}.json`), JSON.stringify(proof, null, 2))
  for (const p of pending.values()) clearTimeout(p.timer)
  ws.close()
}
