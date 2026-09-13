import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import { performance } from 'node:perf_hooks'
import { reportRuntimeError } from '../error-diagnostics.js'
import type { ResolvedConfig } from '../../config.js'
import { WindowsMediaHost } from '../media/windows-media-host.js'
import type { BinaryAsset } from '../providers/contracts.js'

export interface MultimodalInput {
  selection: ModelSelection
  image?: ImageAttachmentRef
  timing: {
    modelSelectionMs: number
    captureMs: number
    attachmentMs: number
  }
}

function acceptsImages(info: LlmResolvedModelInfo): boolean {
  return info.inputModalities?.includes('image') ?? false
}

export class MultimodalRouter {
  private cachedSelection?: {
    defaultModelKey: string
    selection: ModelSelection
    expiresAt: number
  }

  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig['vision'],
    private readonly media: WindowsMediaHost,
  ) {}

  private async findImageModel(signal: AbortSignal): Promise<ModelSelection | undefined> {
    if (this.config.strictModel !== false) {
      const selection: ModelSelection = { provider: this.config.provider, model: this.config.model }
      const info = await this.ctx.llm.resolveModelInfo(selection.provider, selection.model, signal)
      if (this.config.enabled && !acceptsImages(info)) throw new Error('配置的游戏模型不支持图片输入')
      const effort = this.config.reasoningEffort ?? 'off'
      // Non-reasoning routes do not accept even an explicit "off" parameter.
      if (effort === 'off' && info.reasoning === undefined) return selection
      if (!info.reasoning?.efforts.some(item => item.id === effort)) throw new Error(`配置的游戏模型不支持思考强度：${effort}`)
      return { ...selection, reasoningEffort: effort as ModelSelection['reasoningEffort'] }
    }
    const preferred = this.ctx.agentDefaultModel.currentSelection()
    const configured = { provider: this.config.provider, model: this.config.model }
    const defaultModelKey = `${configured.provider}\u0000${configured.model}\u0000${preferred.provider}\u0000${preferred.model}`
    if (this.cachedSelection?.defaultModelKey === defaultModelKey
      && this.cachedSelection.expiresAt > Date.now()) {
      return this.cachedSelection.selection
    }
    try {
      const info = await this.ctx.llm.resolveModelInfo(configured.provider, configured.model, signal)
      if (acceptsImages(info)) return this.rememberSelection(defaultModelKey, configured)
    } catch {
      // A developer build may omit the product provider and use its own image route.
    }
    try {
      const info = await this.ctx.llm.resolveModelInfo(preferred.provider, preferred.model, signal)
      if (acceptsImages(info)) return this.rememberSelection(defaultModelKey, preferred)
    } catch {
      // Search the configured catalog for a model that can answer from the image directly.
    }
    for (const provider of this.ctx.llm.listProviders()) {
      let models
      try { models = await this.ctx.llm.listModels(provider.id) } catch { continue }
      for (const model of models) {
        if (!model.inputModalities?.includes('image')) continue
        try {
          const info = await this.ctx.llm.resolveModelInfo(provider.id, model.id, signal)
          if (acceptsImages(info)) {
            return this.rememberSelection(defaultModelKey, { provider: provider.id, model: model.id })
          }
        } catch {
          // Keep looking; catalogs can contain unavailable routes.
        }
      }
    }
    return undefined
  }

  private rememberSelection(defaultModelKey: string, selection: ModelSelection): ModelSelection {
    this.cachedSelection = {
      defaultModelKey,
      selection,
      expiresAt: Date.now() + 5 * 60_000,
    }
    return selection
  }

  async selectModel(signal: AbortSignal): Promise<ModelSelection> {
    const selection = await this.findImageModel(signal)
    if (selection === undefined) throw new Error('没有可用的图片输入模型')
    return selection
  }

  async prepareProcess(processId: number | undefined, signal: AbortSignal): Promise<MultimodalInput> {
    const selectionStarted = performance.now()
    const selection = await this.selectModel(signal)
    const captureStarted = performance.now()
    const textOnly = (): MultimodalInput => ({ selection, timing: { modelSelectionMs: captureStarted - selectionStarted, captureMs: performance.now() - captureStarted, attachmentMs: 0 } })
    if (!this.config.enabled || processId === undefined) return textOnly()
    try {
    const image: BinaryAsset = await this.media.captureProcessWindow(processId, this.config.maxWidth, AbortSignal.any([signal, AbortSignal.timeout(5000)]))
    if (image.mediaType !== 'image/png' && image.mediaType !== 'image/jpeg') throw new Error(`Windows 媒体服务返回了不支持的截图格式：${image.mediaType}`)
    const attachmentStarted = performance.now()
    const attachment = await this.ctx.attachments.saveImage({
      data: image.bytes,
      mediaType: image.mediaType,
      name: image.mediaType === 'image/png' ? 'game-window.png' : 'game-window.jpg',
    })
    const finished = performance.now()
    return {
      selection,
      image: attachment,
      timing: {
        modelSelectionMs: captureStarted - selectionStarted,
        captureMs: attachmentStarted - captureStarted,
        attachmentMs: finished - attachmentStarted,
      },
    }
    } catch (error) {
      signal.throwIfAborted()
      reportRuntimeError(error, { stage: 'agent.vision.text-only', processId, recovered: true })
      return textOnly()
    }
  }
}
