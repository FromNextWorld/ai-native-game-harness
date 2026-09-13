// Surgical lifecycle integration into the inspected installed release. No live writes.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import ts from 'typescript'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const prior = JSON.parse(readFileSync(join(resolve(process.argv[2]), 'manifest.json'), 'utf8'))
const installed = prior.installed
const files = [...Object.keys(prior.stagedHashes), 'runtime/agent/session-ownership.js']
const root = mkdtempSync(join(tmpdir(), 'xty-session-stage-'))
const hashes = {}
const hash = value => createHash('sha256').update(value).digest('hex')
for (const file of files) {
  const target = join(installed, file)
  hashes[file] = existsSync(target) ? hash(readFileSync(target)) : null
  if (file in prior.stagedHashes && hashes[file] !== prior.stagedHashes[file]) throw new Error(`Changed installed file: ${file}`)
  mkdirSync(dirname(join(root, 'stage', file)), { recursive: true })
  if (existsSync(target)) copyFileSync(target, join(root, 'stage', file))
}
function replaceOnce(text, before, after) {
  if (text.split(before).length !== 2) throw new Error(`Missing/ambiguous integration anchor: ${before.slice(0, 90)}`)
  return text.replace(before, after)
}
function methods(text) {
  const tree = ts.createSourceFile('agent.mjs', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const cls = tree.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'GameAgentSession')
  if (!cls) throw new Error('GameAgentSession class missing')
  return new Map(cls.members.filter(ts.isMethodDeclaration).map(node => [node.name.getText(tree), { start: node.getStart(tree), end: node.end, text: node.getText(tree) }]))
}
const agentPath = join(root, 'stage', 'runtime/agent/game-agent-session.js')
const original = readFileSync(agentPath, 'utf8').replaceAll('\r\n', '\n')
const fresh = readFileSync(join(repo, 'plugins/xiaotangyuan-game/dist/runtime/agent/game-agent-session.js'), 'utf8')
const oldMethods = methods(original), newMethods = methods(fresh)
const replacements = ['createAgent', 'resumeOrCreateAgent', 'ensureAgent', 'cancel', 'dispose']
const edits = replacements.map(name => {
  if (!oldMethods.has(name) || !newMethods.has(name)) throw new Error(`Lifecycle method missing: ${name}`)
  return { ...oldMethods.get(name), text: newMethods.get(name).text }
})
edits.push({ ...oldMethods.get('waitForSessionRelease'), text: '' })
if (!Number.isInteger(edits.at(-1).start)) throw new Error('Expected old polling guard missing')
let agent = original
for (const edit of edits.sort((a, b) => b.start - a.start)) agent = agent.slice(0, edit.start) + edit.text + agent.slice(edit.end)
agent = replaceOnce(agent, "import { reportRuntimeError } from '../error-diagnostics.js';", "import { reportRuntimeError } from '../error-diagnostics.js';\nimport { isMissingSession, sessionOwnership, waitForSessionIdle } from './session-ownership.js';")
agent = replaceOnce(agent, '    handle;', '    handle;\n    lease;\n    lifecycle = new AbortController();')
agent = replaceOnce(agent, '    async execute(request, mode, source) {', '    async execute(request, mode, source) {\n        this.lifecycle.signal.throwIfAborted();')
const run = '            const result = await this.run(handle, request, input.image, mode, interactionId, source, longTermMemory);'
agent = replaceOnce(agent, run, run + '\n            this.lifecycle.signal.throwIfAborted();')
agent = agent.replace(/^const SESSION_RELEASE_(?:TIMEOUT|POLL)_MS = .*;\n/gm, '')
writeFileSync(agentPath, agent)
// All unrelated methods (including skills, learning, policy and Work) stay byte-identical.
for (const [name, method] of oldMethods) {
  if ([...replacements, 'waitForSessionRelease', 'execute'].includes(name)) continue
  if (methods(agent).get(name)?.text !== method.text) throw new Error(`Unrelated method changed: ${name}`)
}
const gatewayPath = join(root, 'stage', 'gateway/game-gateway.js')
let gateway = readFileSync(gatewayPath, 'utf8').replaceAll('\r\n', '\n')
gateway = replaceOnce(gateway, '.then(() => this.onMessage(state, data))', `.then(() => {
                if (!this.connections.has(state) || socket.readyState !== WebSocket.OPEN) return;
                return this.onMessage(state, data);
            })`)
writeFileSync(gatewayPath, gateway)
copyFileSync(join(repo, 'plugins/xiaotangyuan-game/dist/runtime/agent/session-ownership.js'), join(root, 'stage/runtime/agent/session-ownership.js'))
const stagedHashes = {}
for (const file of files) {
  const path = join(root, 'stage', file)
  writeFileSync(path, readFileSync(path, 'utf8').replace(/^\/\/# sourceMappingURL=.*$/gm, ''))
  execFileSync(process.execPath, ['--check', path])
  stagedHashes[file] = hash(readFileSync(path))
}
writeFileSync(join(root, 'manifest.json'), JSON.stringify({ installed, hashes, stagedHashes, prepared: true, kind: 'session-lifecycle' }, null, 2))
console.log(JSON.stringify({ root, prepared: true, installedModified: false, unchangedMethodsVerified: true }))
