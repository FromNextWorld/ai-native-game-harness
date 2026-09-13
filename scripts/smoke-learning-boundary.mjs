// Actual installed DSH runtime + staged source plugin, adversarial mock LLM and synthetic game.
// Forces the exact wrong learning choice and verifies the runtime blocks trial, then invokes summon.
import { createServer } from 'node:http'
import { createServer as tcpServer } from 'node:net'
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
const repo = resolve(import.meta.dirname, '..')
const stage = mkdtempSync(join(repo, '.artifacts/learning-boundary-smoke-'))
const m = { pkg: join(repo, 'plugins/xiaotangyuan-game') }
const runtime = resolve(process.env.AGH_SMOKE_RUNTIME ?? join(repo, '.artifacts/desktop-runtime'))
const base = mkdtempSync(join(stage, 'runtime-smoke-'))
const delay = ms => new Promise(r => setTimeout(r, ms))
async function listen(server) { await new Promise(r => server.listen(0, '127.0.0.1', r)); return server.address().port }
async function port() { const server = tcpServer(), p = await listen(server); await new Promise(r => server.close(r)); return p }
const gateway = await port(), web = await port()
const proof = { realDsh: true, realModel: false, realGame: false, requests: [], atoms: [], errors: [] }
let step = 0, child, socket, output = ''
const mock = createServer(async (req, res) => {
  try {
    let text = ''; for await (const chunk of req) text += chunk
    const input = JSON.parse(text)
    const system = input.messages.filter(x => x.role === 'system').map(x => x.content).join('\n')
    const classifier = system.includes('Validate whether the CURRENT player request')
    const tools = input.tools?.map(x => x.function.name) ?? []
    proof.requests.push({ classifier, tools })
    let message
    if (classifier) message = { role: 'assistant', content: '{"kind":"execute","tool":"xiaotangyuan_sword_formation"}' }
    else if (step++ === 0) {
      assert(tools.includes('xiaotangyuan_skill_learn'))
      assert(!tools.includes('game_learning_skill_learn'))
      message = { role: 'assistant', content: null, tool_calls: [{ id: 'wrong-learning', type: 'function', function: { name: 'xiaotangyuan_skill_learn', arguments: JSON.stringify({ skillId: 'stardew.wanjian-guizong', name: '万剑归宗', description: '召唤剑阵', triggers: '万剑归宗', sourceCode: 'let args = params || {};' }) } }] }
    } else if (step === 2) {
      assert(!tools.some(x => x.endsWith('skill_learn')), 'Learning schemas must disappear after denial')
      assert(system.includes('xiaotangyuan_sword_formation'))
      assert(input.messages.some(x => x.role === 'tool' && JSON.stringify(x.content).includes('尚未编译')))
      message = { role: 'assistant', content: null, tool_calls: [{ id: 'correct-summon', type: 'function', function: { name: 'xiaotangyuan_sword_formation', arguments: '{"mode":"summon"}' } }] }
    } else message = { role: 'assistant', content: '崽崽剑阵已召唤，只环绕不攻击。' }
    if (!input.stream) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: 'mock', object: 'chat.completion', model: input.model, choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })); return }
    res.setHeader('content-type', 'text/event-stream')
    const chunk = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', created: 1, model: input.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
    chunk({ ...message, ...(message.tool_calls ? { tool_calls: message.tool_calls.map((t, index) => ({ index, ...t })) } : {}) })
    chunk({}, message.tool_calls ? 'tool_calls' : 'stop'); res.end('data: [DONE]\n\n')
  } catch (error) { proof.errors.push(error.message); res.statusCode = 500; res.end(JSON.stringify({ error: { message: error.message } })) }
})
const modelPort = await listen(mock)
writeFileSync(join(base, 'settings.yaml'), `llm-pi-ai:\n  providers:\n    smoke-local:\n      displayName: Boundary Smoke\n      apiKeyEnv: XIAOTANGYUAN_SMOKE_API_KEY\n      api: openai-completions\n      baseURL: http://127.0.0.1:${modelPort}/v1\n      models:\n        - id: smoke-vision\n          name: Smoke Vision\n          contextWindow: 32768\n          maxTokens: 4096\n          input: [text, image]\nagent-default-model:\n  provider: smoke-local\n  model: smoke-vision\n`)
const patch = join(base, 'patch.yml')
writeFileSync(patch, `- insert:\n    - id: boundary-work\n      name: '${pathToFileURL(join(runtime, 'node_modules/@qimidandapigu/dsh-work-orchestrator/dist/index.js')).href}'\n      config:\n        enabled: false\n    - id: boundary-game\n      name: '${pathToFileURL(join(m.pkg, 'dist/index.js')).href}'\n      config:\n        host: 127.0.0.1\n        port: ${gateway}\n        vision:\n          enabled: false\n        speech:\n          enabled: false\n        media:\n          enabled: false\n        proactiveChat:\n          enabled: false\n        memory:\n          enabled: false\n        feedback:\n          enabled: false\n`)
writeFileSync(patch, readFileSync(patch, 'utf8').replace('        vision:\n          enabled: false', '        vision:\n          enabled: false\n          provider: smoke-local\n          model: smoke-vision\n          reasoningEffort: off\n          strictModel: true'))
try {
  child = spawn(process.execPath, [join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), 'web', '--patch', patch, '--no-open', '--host', '127.0.0.1', '--port', String(web)], {
    cwd: runtime, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DSH_HOME: base, DSH_DISABLE_HMR: '1', DSH_TELEMETRY_MODE: 'DISABLED', XIAOTANGYUAN_SMOKE_API_KEY: 'local-test-only' },
  })
  child.stdout.on('data', b => { output += b }); child.stderr.on('data', b => { output += b })
  const deadline = Date.now() + 60_000
  while (true) {
    assert.equal(child.exitCode, null, 'Runtime exited before ready')
    try { if ((await fetch(`http://127.0.0.1:${web}`, { signal: AbortSignal.timeout(1000) })).ok) break } catch {}
    assert(Date.now() < deadline, 'Runtime readiness timeout'); await delay(250)
  }
  while (true) {
    try {
      socket = new WebSocket(`ws://127.0.0.1:${gateway}`)
      await new Promise((r, j) => { socket.onopen = r; socket.onerror = j })
      break
    } catch { socket?.close(); assert(Date.now() < deadline, 'Gateway readiness timeout'); await delay(250) }
  }
  const pending = new Map(); let id = 0
  socket.onmessage = e => {
    const event = JSON.parse(e.data)
    if (event.method === 'game.atom.execute') {
      const { atom, arguments: args } = event.params
      proof.atoms.push(atom)
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: event.id, result: { opId: args.opId, state: 'orbit', preview: true, count: args.count, remaining: args.count, hits: 0, damage: 0, kills: 0, reason: '' } }))
    } else if (pending.has(event.id)) { const p = pending.get(event.id); pending.delete(event.id); clearTimeout(p.timer); event.error ? p.reject(Error(event.error.message)) : p.resolve(event.result) }
  }
  const rpc = (method, params) => new Promise((resolve, reject) => { const rid = ++id; const timer = setTimeout(() => { pending.delete(rid); reject(Error(method + ' timed out')) }, 30_000); pending.set(rid, { resolve, reject, timer }); socket.send(JSON.stringify({ jsonrpc: '2.0', id: rid, method, params })) })
  await rpc('adapter.hello', { adapterId: 'diagnostic.learning-boundary', gameId: 'stardew-valley', saveId: 'isolated-boundary', protocolVersion: '1.1', version: 'test', capabilities: ['create', 'formation', 'launch', 'status', 'cancel'].map(x => 'stardew.projectiles_' + x) })
  proof.result = await rpc('chat.send', { text: '释放万剑归宗。', context: { saveId: 'isolated-boundary', location: 'Farm' } })
  assert.deepEqual(proof.atoms, ['stardew.projectiles_create'])
  assert.equal(proof.requests.filter(r => r.classifier).length, 1)
  assert(!proof.result.reply.includes('没学会'))
  assert.deepEqual(proof.errors, [])
  proof.passed = true
} catch (error) { proof.passed = false; proof.error = String(error); process.exitCode = 1 }
finally {
  socket?.close()
  if (child && child.exitCode === null) {
    await new Promise(r => { const timer = setTimeout(() => child.kill('SIGKILL'), 3000); child.once('exit', () => { clearTimeout(timer); r() }); child.kill('SIGTERM') })
  }
  await new Promise(r => { mock.close(r); mock.closeAllConnections() })
  proof.childExited = child?.exitCode !== null || child?.signalCode !== null
  writeFileSync(join(base, 'runtime.log'), output)
  writeFileSync(join(stage, 'runtime-smoke.json'), JSON.stringify(proof, null, 2))
  console.log(JSON.stringify(proof))
  if (!proof.passed) console.log(output.slice(-5000))
}
