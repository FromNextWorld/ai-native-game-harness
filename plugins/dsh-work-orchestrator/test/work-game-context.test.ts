import { it, expect } from 'vitest'
import { registerWorkGameContextTool } from '../src/work-game-context.js'
it('loads facts first, renders images only on explicit demand', async () => {
  let tool: any
  registerWorkGameContextTool({ tools: { register: (value: any) => { tool = value } } } as any, () => ({ gameId: 'stardew-valley', saveId: 'farm', capturedAt: 'now', recentEvents: [], screenshots: [{ at: 'now', image: { attachmentId: 'one', mediaType: 'image/png' } as any }] }))
  const exec = { signal: new AbortController().signal }
  const facts = await tool.execute({}, exec)
  expect(JSON.parse(facts.contextJson).gameId).toBe('stardew-valley')
  expect(tool.output.render({}, facts).some((b: any) => b.type === 'image')).toBe(false)
  const images = await tool.execute({ includeImages: true }, exec)
  expect(tool.output.render({}, images).find((b: any) => b.type === 'image').attachment.attachmentId).toBe('one')
})
it('reports missing evidence without searching shared folders', async () => {
  let tool: any
  registerWorkGameContextTool({ tools: { register: (value: any) => { tool = value } } } as any, () => undefined)
  const value = await tool.execute({ includeImages: true }, { signal: new AbortController().signal })
  expect(JSON.parse(value.contextJson).available).toBe(false)
  expect(value.imagesJson).toBe('[]')
})
