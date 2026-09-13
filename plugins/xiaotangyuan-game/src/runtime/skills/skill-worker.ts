import { SkillRuntime } from './skill-runtime.js'
import type { SkillProgram, SkillRecord } from './contracts.js'

let started = false
let nextId = 0
const pending = new Map<number, { resolve: (value: unknown) => void, reject: (error: Error) => void }>()
process.on('message', async (message: any) => {
  if (message?.type === 'atom-result') {
    const call = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) call?.reject(new Error(String(message.error)))
    else call?.resolve(message.result)
    return
  }
  if (started || message?.type !== 'run') return
  started = true
  const controller = new AbortController()
  const result = await new SkillRuntime().run(String(message.skillId), Number(message.skillVersion),
    message.program as SkillProgram, new Set<string>(message.atoms),
    (atom, args) => new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject })
      process.send?.({ type: 'atom', id, atom, args })
    }), controller.signal, { dependencies: new Map<string, SkillRecord>(message.dependencies), params: message.params })
  process.send?.({ type: 'result', result }, undefined, undefined, () => process.disconnect())
})
process.once('disconnect', () => process.exit(0))
