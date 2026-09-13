import { describe, expect, it } from 'vitest'
import { explainSelectedEvidence } from '../src/diagnostics.js'

describe('selected-object evidence', () => {
  const now = Date.parse('2026-09-07T12:00:00Z')
  const run = (data: object) => explainSelectedEvidence(JSON.stringify({ available: true, capturedAt: new Date(now).toISOString(), name: '水泵', cell: 42, ...data }), now)
  it('rejects invalid JSON and missing selection', () => {
    expect(explainSelectedEvidence('broken', now).success).toBe(false)
    expect(run({ available: false }).success).toBe(false)
  })
  it('rejects old and future evidence', () => {
    for (const offset of [-16000, 6000]) expect(run({ capturedAt: new Date(now + offset).toISOString() }).success).toBe(false)
    expect(run({ capturedAt: 'invalid' }).success).toBe(false)
  })
  it('reports real statuses without inventing an overload or topology', () => {
    const result = run({ statuses: ['缺电', '输出管道堵塞'], operational: false, operationalFlags: [{ name: 'Powered', value: false }], temperatureC: 34.25 })
    expect(result.success).toBe(true)
    for (const text of ['缺电', 'Powered', '34.3℃', '不能仅凭停机判断整条线路过载', '尚不能断言堵在哪一格']) expect(result.reply).toContain(text)
  })
  it('does not equate absent status with healthy machinery', () => {
    expect(run({ statuses: [] }).reply).toContain('不能据此判断没有故障')
  })
  it('ignores malformed status entries', () => {
    expect(run({ statuses: [null, 3, {}], operationalFlags: [null, 2, {}, { name: 'Ready', value: true }] }).success).toBe(true)
  })
  it('distinguishes measured overload from potential overload using circuit values', () => {
    const result = run({ circuit: { usedW: 1500, requestedW: 1600, generatedW: 400, storedJ: 0, safeW: 1000 } })
    expect(result.reply).toContain('当前电路负载已超过'); expect(result.reply).toContain('没有可用储电')
    expect(run({ circuit: { usedW: 500, requestedW: 1600, generatedW: 1600, storedJ: 1000, safeW: 1000 } }).reply).toContain('同时启动时可能')
  })
  it('reports actual disconnected ports and missing network endpoints', () => {
    const r = run({ input: { connected: false }, pipeNetworks: [{ id: 1, type: 'Liquid', sources: [1], sinks: [], cells: [] }] })
    expect(r.reply).toContain('输入管口未连接'); expect(r.reply).toContain('没有接收端')
  })
})
