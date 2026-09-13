import { expect, it, vi } from 'vitest'
import { registerConfiguredSpeechExtension } from '../src/runtime/providers/speech-extension.js'

it('loads only a configured local speech plugin and awaits registration', async () => {
  const register = vi.fn(async () => undefined)
  const load = vi.fn(async () => ({ registerSpeechCapabilities: register }))
  const ctx = {} as never, registry = {} as never, options = { baseUrl: 'http://127.0.0.1:1234' }
  await registerConfiguredSpeechExtension(ctx, registry, undefined, load)
  expect(load).not.toHaveBeenCalled()
  await registerConfiguredSpeechExtension(ctx, registry, { extensionModule: 'file:///C:/plugins/speech.mjs', extensionOptions: options }, load)
  expect(register).toHaveBeenCalledWith(ctx, registry, options)
})
it('fails on remote modules, missing registration, or plugin setup errors', async () => {
  const load = vi.fn(async () => ({}))
  await expect(registerConfiguredSpeechExtension({} as never, {} as never, { extensionModule: 'https://example.com/speech.mjs' }, load)).rejects.toThrow('本地插件')
  expect(load).not.toHaveBeenCalled()
  const config = { extensionModule: 'file:///C:/plugins/speech.mjs' }
  await expect(registerConfiguredSpeechExtension({} as never, {} as never, config, load)).rejects.toThrow('注册入口')
  await expect(registerConfiguredSpeechExtension({} as never, {} as never, config, async () => ({ registerSpeechCapabilities: () => { throw Error('setup failed') } }))).rejects.toThrow('setup failed')
})
