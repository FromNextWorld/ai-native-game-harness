import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { MemoryStore } from '../src/runtime/memory/memory-store.js'
import { MemoryService } from '../src/runtime/memory/memory-service.js'
import { assertMemoryIntegrity, backupMemory } from '../src/runtime/memory/memory-health.js'
import { XiaoTangYuanLearningService } from '../src/runtime/learning-service.js'
import { registerMemoryTools } from '../src/tools/memory-tools.js'

const directories: string[] = []
const identity = { gameId: 'stardew-valley', saveId: 'farm' }
const adapter = { ...identity, adapterId: 'test', protocolVersion: '1.1', version: '1' }
const config = () => {
  const directory = mkdtempSync(join(tmpdir(), 'memory-health-'))
  directories.push(directory)
  vi.stubEnv('DSH_HOME', directory)
  return { enabled: true, autoLearn: true, directory, profileId: 'test', maxGameEntries: 50 }
}
const context = () => ({ logger: { warn: vi.fn() }, llm: { stream: vi.fn() } }) as unknown as Context
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllEnvs()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('memory persistence health and isolation', () => {
  it('keeps corrupt bytes intact and allows service construction without a working memory store', async () => {
    const c = config(), path = join(c.directory, 'memory-v1.sqlite')
    const broken = Buffer.from('broken database: preserve as evidence')
    writeFileSync(path, broken)
    const service = new MemoryService(context(), c)
    expect(service.available).toBe(false)
    expect(service.status.errorId).toBeTruthy()
    expect(service.recall(adapter, { text: '万剑归宗' })).toBeUndefined()
    expect(() => service.adapterConnected('a', adapter)).not.toThrow()
    expect(() => service.observeSession('a', adapter)).not.toThrow()
    expect(() => service.store).toThrow('本地长期记忆暂不可用')
    await service.close(); await service.close()
    expect(readFileSync(path)).toEqual(broken)
    const diagnostic = readdirSync(join(c.directory, 'diagnostics')).find(f => f.startsWith('errors-'))!
    const text = readFileSync(join(c.directory, 'diagnostics', diagnostic), 'utf8')
    expect(text).toContain('memory.startup')
    expect(text).toContain('not a database')
    expect(text.trim().split('\n')).toHaveLength(1)
  })

  it('stops queued extraction after a storage fault and does not affect future chat context', async () => {
    const c = config(), ctx = context(), service = new MemoryService(ctx, c)
    const store = service.store
    vi.spyOn(store, 'recordPlayedGame').mockImplementation(() => { throw new Error('SQLITE_CORRUPT injected') })
    service.adapterConnected('a', adapter)
    service.scheduleLearn('a', adapter, { text: '记一下' }, '好的', 'turn', { provider: 'mock', model: 'mock' })
    expect(service.available).toBe(false)
    expect(service.recall(adapter, { text: '你好' })).toBeUndefined()
    await service.flush()
    expect(ctx.llm.stream).not.toHaveBeenCalled()
    await service.close()
  })

  it('exposes an explicit degraded state instead of pretending the memory list was cleared', async () => {
    const c = config()
    writeFileSync(join(c.directory, 'memory-v1.sqlite'), 'broken')
    const memory = new MemoryService(context(), c)
    const snapshot = XiaoTangYuanLearningService.prototype.snapshot.call({ memory, skills: undefined } as never)
    expect(snapshot.enabled.memory).toBe(false)
    expect(snapshot.memoryStatus).toMatchObject({ available: false, errorId: expect.any(String) })
    expect(snapshot.memories).toEqual([])
    await memory.close()
  })

  it('does not let explicit correction tools report success when persistence is unavailable', async () => {
    const c = config(), tools: any[] = []
    writeFileSync(join(c.directory, 'memory-v1.sqlite'), 'broken')
    const memory = new MemoryService(context(), c)
    registerMemoryTools({ tools: { register: (tool: unknown) => tools.push(tool) } } as unknown as Context, memory)
    await expect(tools.find(tool => tool.name.endsWith('correct_shared')).execute({ field: 'interests', value: '种田', clear: false })).rejects.toThrow('本地长期记忆暂不可用')
    await memory.close()
  })

  it('validates backups with committed WAL contents and retains their actual rows', () => {
    const c = config(), store = new MemoryStore(c)
    store.updateSharedProfile({ interests: ['种田'] })
    store.remember(identity, [{ kind: 'goal', subject: 'farm', summary: '种南瓜', importance: 4 }], 'turn')
    const db = new DatabaseSync(store.databasePath)
    const backup = backupMemory(db, store.databasePath)
    const saved = new DatabaseSync(backup, { readOnly: true })
    assertMemoryIntegrity(saved)
    expect(saved.prepare('SELECT count(*) AS n FROM game_memory').get()?.n).toBe(1)
    expect(String(saved.prepare('SELECT data_json FROM shared_profile').get()?.data_json)).toContain('种田')
    saved.close(); db.close(); store.close(); store.close()
  })

  it('records backup failures separately without disabling a healthy store', async () => {
    const c = config()
    writeFileSync(join(c.directory, 'memory-backups'), 'blocked-directory')
    const service = new MemoryService(context(), c)
    expect(service.available).toBe(true)
    service.store.updateSharedProfile({ interests: ['探索'] })
    expect(service.store.getSharedProfile().interests).toEqual(['探索'])
    await service.close()
    const diagnostic = readdirSync(join(c.directory, 'diagnostics')).find(f => f.startsWith('errors-'))!
    expect(readFileSync(join(c.directory, 'diagnostics', diagnostic), 'utf8')).toContain('memory.backup')
  })

  it('keeps healthy profiles, statistics and memory intact across a normal reopen', () => {
    const c = config(), first = new MemoryStore(c)
    first.updateSharedProfile({ interests: ['钓鱼'] })
    first.beginPlaySession('session', identity, 1_000)
    first.endPlaySession('session', identity, 2_000)
    first.remember(identity, [{ kind: 'goal', subject: 'fish', summary: '钓鲤鱼', importance: 4 }], 'turn')
    first.close()
    const next = new MemoryStore(c)
    expect(next.listGameMemory(identity)).toHaveLength(1)
    expect(next.listPlayStatistics()[0]?.sessionCount).toBe(1)
    expect(next.getSharedProfile().interests).toEqual(['钓鱼'])
    next.close()
    expect(readdirSync(join(c.directory, 'memory-backups')).filter(f => f.endsWith('.sqlite')).length).toBe(4)
  })
})
