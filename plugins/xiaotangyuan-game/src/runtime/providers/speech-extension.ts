import type { Context } from '@deepseek-ai/cordis'
import type { CapabilityRegistry } from '../capabilities.js'
import type { SpeechConfig } from '../../config.js'

export async function registerConfiguredSpeechExtension(
  ctx: Context, capabilities: CapabilityRegistry, config: SpeechConfig | undefined,
  load: (url: string) => Promise<{ registerSpeechCapabilities?: unknown }> = url => import(url),
): Promise<void> {
  if (!config?.extensionModule) return
  const url = new URL(config.extensionModule)
  if (url.protocol !== 'file:') throw new Error('语音扩展必须是已安装的本地插件。')
  const extension = await load(url.href)
  if (typeof extension.registerSpeechCapabilities !== 'function') throw new Error('语音扩展缺少能力注册入口。')
  await extension.registerSpeechCapabilities(ctx, capabilities, config.extensionOptions)
}
