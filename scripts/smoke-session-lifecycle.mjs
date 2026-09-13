// Synthetic Adapter lifecycle only: no user speech, screenshots, model turns or game actions.
import { createRequire } from 'node:module'
import { openSync, readSync, closeSync, statSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(repo, 'plugins/xiaotangyuan-game/package.json'))
const WebSocket = require('ws')
const logPath = process.argv[2]
if (!logPath) throw new Error('Explicit runtime.log required')
const saveId = `diagnostic-lifecycle-${randomUUID()}`
const sessionId = `game-stardew-valley-${createHash('sha256').update(`stardew-valley\u0000${saveId}`).digest('hex').slice(0, 24)}`
const offset = statSync(logPath).size
const sockets = []
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
function records() {
  const end = statSync(logPath).size
  const size = Math.min(end - offset, 2_000_000)
  const buffer = Buffer.alloc(size), fd = openSync(logPath, 'r')
  try { readSync(fd, buffer, 0, size, end - size) } finally { closeSync(fd) }
  return buffer.toString().split('\n').flatMap(line => {
    const begin = line.indexOf('AI_GAME_HARNESS_DIAGNOSTIC ')
    if (begin < 0) return []
    try { return [JSON.parse(line.slice(begin + 'AI_GAME_HARNESS_DIAGNOSTIC '.length))] } catch { return [] }
  }).filter(record => record.kind === 'game-session.lifecycle' && record.sessionId === sessionId)
}
async function ready(count) {
  const deadline = Date.now() + 12_000
  do {
    if (records().filter(row => row.detail.phase === 'ready').length >= count) return
    await pause(100)
  } while (Date.now() < deadline)
  throw new Error(`Missing native session ready ${count}; diagnostic session ${sessionId}`)
}
async function connect() {
  const socket = new WebSocket('ws://127.0.0.1:33145')
  sockets.push(socket)
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Adapter hello timed out')), 5000)
    socket.on('message', raw => {
      const message = JSON.parse(raw.toString())
      if (message.id !== 'hello') return
      clearTimeout(timer)
      if (message.error) reject(new Error(JSON.stringify(message.error)))
      else resolve()
    })
    socket.send(JSON.stringify({ jsonrpc: '2.0', id: 'hello', method: 'adapter.hello', params: {
      adapterId: 'diagnostic.session-lifecycle', gameId: 'stardew-valley', version: 'test', protocolVersion: '1.1', saveId, capabilities: [],
    } }))
  })
  return socket
}
try {
  const first = await connect(); await ready(1)
  await connect(); await ready(2)
  first.close() // Delayed old close must not unregister the replacement.
  await pause(250)
  await connect(); await ready(3)
  console.log(JSON.stringify({ passed: true, sessionId, readyTransitions: records().filter(row => row.detail.phase === 'ready').length, modelTurns: 0, gameActions: 0 }))
} finally {
  for (const socket of sockets) socket.close()
}
