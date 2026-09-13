import { it, expect, vi } from 'vitest'
import { MultimodalRouter } from '../src/runtime/multimodal/multimodal-router.js'
import { resolveConfig } from '../src/config.js'
vi.mock('../src/runtime/error-diagnostics.js', () => ({ reportRuntimeError: vi.fn() }))
function setup() {
  const media = { captureProcessWindow: vi.fn(async () => { throw Error('not foreground') }) }
  const ctx = { llm: { resolveModelInfo: vi.fn(async () => ({ inputModalities: ['text', 'image'] })) }, attachments: { saveImage: vi.fn() } }
  return { media, ctx, router: new MultimodalRouter(ctx as never, resolveConfig().vision, media as never) }
}
it('missing process never captures the desktop', async () => {
  const s = setup(); expect((await s.router.prepareProcess(undefined, AbortSignal.timeout(1000))).image).toBeUndefined()
  expect(s.media.captureProcessWindow).not.toHaveBeenCalled(); expect(s.ctx.attachments.saveImage).not.toHaveBeenCalled()
})
it('window capture failure degrades to text without switching models', async () => {
  const s = setup(); const r = await s.router.prepareProcess(42, AbortSignal.timeout(1000))
  expect(r.image).toBeUndefined(); expect(r.selection.reasoningEffort).toBeUndefined()
})
it('only sends off to a model which explicitly supports it', async () => {
  const s = setup()
  s.ctx.llm.resolveModelInfo.mockResolvedValueOnce({ inputModalities: ['text', 'image'], reasoning: { efforts: [{ id: 'off', name: 'Off' }] } } as never)
  expect((await s.router.selectModel(AbortSignal.timeout(1000))).reasoningEffort).toBe('off')
})
it('rejects an unsupported effort instead of making a doomed model call', async () => {
  const s = setup()
  s.ctx.llm.resolveModelInfo.mockResolvedValueOnce({ inputModalities: ['text', 'image'], reasoning: { efforts: [{ id: 'high', name: 'High' }] } } as never)
  await expect(s.router.selectModel(AbortSignal.timeout(1000))).rejects.toThrow('不支持思考强度')
})
it('model/auth failure is not concealed as a screenshot fallback', async () => {
  const s = setup(); s.ctx.llm.resolveModelInfo.mockRejectedValueOnce(Error('credentials unavailable'))
  await expect(s.router.prepareProcess(42, AbortSignal.timeout(1000))).rejects.toThrow('credentials')
})
