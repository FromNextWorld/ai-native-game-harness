/** Configuration checks never imply a successful microphone or paid provider call. */
export function voiceReadinessText(state, online = true) {
  if (!online) return '助手连接已断开，语音状态待重新检查。'
  if (!state) return '语音状态尚未确认；助手在线不代表语音可用。'
  if (!state.enabled) return '语音未启用；仍可使用文字对话。'
  const labels = { configured: '配置就绪', unavailable: '不可用，请检查设置', timeout: '检查超时，请稍后重试', ready: '已启动', starting: '正在启动', unchecked: '待检查' }
  return `识别：${labels[state.asr] ?? '待检查'}；播报：${labels[state.tts] ?? '待检查'}；媒体服务：${labels[state.media] ?? '待检查'}。麦克风与联网调用仍需实际说话测试。`
}
