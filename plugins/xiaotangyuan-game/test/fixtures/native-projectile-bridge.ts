import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import { runSwordFormation, supportsPreviewHandoff, supportsChopSweep, supportsSwordPower } from '../../src/runtime/tasks/sword-formation.js'
import type { GameAtomExecutor } from '../../src/runtime/skills/contracts.js'

export function nativeProjectileBridge(dll: string, resources = false) {
  const child = spawn(process.env.AGH_DOTNET ?? resolve(process.env.USERPROFILE!, '.cache/dotnet-sdk/dotnet.exe'), [dll, '--bridge', ...(resources ? ['--resources'] : [])], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  const pending: { resolve: (value: any) => void; reject: (reason: Error) => void }[] = []
  let failure = ''
  child.stderr!.on('data', chunk => { failure += chunk })
  child.on('error', error => { while (pending.length) pending.shift()!.reject(error) })
  child.on('exit', code => { while (pending.length) pending.shift()!.reject(new Error(`Native bridge exited ${code}: ${failure}`)) })
  createInterface({ input: child.stdout! }).on('line', line => {
    const waiter = pending.shift()!
    const value = JSON.parse(line)
    if (value.error) waiter.reject(new Error(value.error)); else waiter.resolve(value.result)
  })
  const request = (method: string, rest: object = {}): Promise<any> => new Promise((resolve, reject) => {
    pending.push({ resolve, reject }); child.stdin!.write(JSON.stringify({ method, ...rest }) + '\n')
  })
  const calls: { atom: string; args: any }[] = []
  const executor: GameAtomExecutor = async (atom, args, signal) => { signal.throwIfAborted(); calls.push({ atom, args }); return request(atom, { arguments: args }) }
  const run = async (mode: 'summon' | 'chop' | 'fish' | 'cast', controller = new AbortController()) => {
    const atoms = await request('hello')
    return runSwordFormation(mode, 8, executor, controller.signal,
      async ms => request('tick', { frames: Math.ceil(ms * 60 / 1000) }), { reusePreview: supportsPreviewHandoff(atoms), chopSweep: resources && supportsChopSweep(atoms), powerBoost: resources && supportsSwordPower(atoms) })
  }
  return { request, executor, run, calls, close: () => child.kill() }
}
