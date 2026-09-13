export function explainSelectedEvidence(reply: string, now = Date.now()): { success: boolean; reply: string } {
  let data: Record<string, unknown>
  try { data = JSON.parse(reply) } catch { return { success: false, reply: '游戏没有返回有效的检查数据，请更新 Bridge 后重试。' } }
  if (!data || data.available !== true) return { success: false, reply: '请先在游戏里点选要检查的建筑或作物。' }
  const time = typeof data.capturedAt === 'string' ? Date.parse(data.capturedAt) : NaN
  if (!Number.isFinite(time) || now - time > 15000 || time - now > 5000)
    return { success: false, reply: '检查数据已过期，请重新检查。' }
  const statuses = Array.isArray(data.statuses) ? data.statuses.filter((s): s is string => typeof s === 'string').slice(0, 32) : []
  const flags = Array.isArray(data.operationalFlags) ? data.operationalFlags.filter(f => f && typeof f === 'object' && f.value === false && typeof f.name === 'string') : []
  const text = statuses.join('；')
  const suggestions: string[] = []
  if (/电力不足|无电力|缺乏电力|缺电|power shortage|no power/i.test(text)) suggestions.push('先检查这台设备的电路连接、发电和燃料；不能仅凭停机判断整条线路过载。')
  if (/管道堵塞|输出.*堵|pipe blocked|output.*blocked/i.test(text)) suggestions.push('先查看输出端及下游接收设备；当前没有整条管网拓扑，尚不能断言堵在哪一格。')
  if (/温度.*[过高低]|过热|too hot|too cold|overheat/i.test(text)) suggestions.push('先核对对象允许温度和附近热源，避免直接拆除整套系统。')
  if (/缺.*资源|资源不足|缺.*材料|awaiting.*delivery|insufficient.*resources/i.test(text)) suggestions.push('先检查所需材料和运送路径，再考虑优先级。')
  const lines = [`检查对象：${String(data.name ?? '未命名对象')}，位置 ${String(data.cell)}。`,
    `游戏实际状态：${statuses.length ? text : '未提供状态提示，不能据此判断没有故障'}。`]
  if (data.operational === false) lines.push('设备当前不满足运行条件。')
  if (flags.length) lines.push(`未满足的运行条件：${flags.map(f => f.name).join('、')}。`)
  if (typeof data.temperatureC === 'number' && Number.isFinite(data.temperatureC)) lines.push(`对象温度：${data.temperatureC.toFixed(1)}℃。`)
  const obj = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
  const circuit = obj(data.circuit)
  if (['usedW', 'requestedW', 'generatedW', 'storedJ', 'safeW'].every(k => typeof circuit[k] === 'number' && Number.isFinite(circuit[k]))) {
    const c = circuit as Record<string, number>
    lines.push(`所在电路：当前负载 ${c.usedW}W，全部启动需求 ${c.requestedW}W，当前发电 ${c.generatedW}W，储电 ${c.storedJ}J，线路安全上限 ${c.safeW}W。`)
    if (c.safeW! > 0 && c.usedW! > c.safeW!) lines.push('当前电路负载已超过线路安全上限：先分流或停用非必要负载，再核对线路规格。')
    else if (c.safeW! > 0 && c.requestedW! > c.safeW!) lines.push('当前未测到超载，但设备同时启动时可能超过线路安全上限。')
    if (c.generatedW! < c.requestedW! && c.storedJ! <= 0) lines.push('当前发电不足以覆盖全部启动需求，且没有可用储电；检查发电机、燃料和供电连接。')
  }
  const input = obj(data.input), output = obj(data.output)
  if (input.connected === false) lines.push('选中设备的输入管口未连接。先检查输入接口对应格子。')
  if (output.connected === false) lines.push('选中设备的输出管口未连接。先接通输出接口。')
  if (output.blocked === true) lines.push('游戏确认该设备输出受阻。下面的管网事实用于缩小范围，不能仅凭满管指认某一格故障。')
  if (Array.isArray(data.pipeNetworks)) for (const raw of data.pipeNetworks.slice(0, 4)) {
    const network = obj(raw)
    if (!Array.isArray(network.sources) || !Array.isArray(network.sinks) || !Array.isArray(network.cells)) continue
    lines.push(`管网 ${String(network.id)}（${String(network.type)}）：${network.sources.length} 个输入源、${network.sinks.length} 个接收端，读取 ${network.cells.length} 格${network.truncated ? '（已截断）' : ''}。`)
    if (!network.sources.length) lines.push('这条连接网络没有输入源；检查源设备出口是否接在同一网络。')
    if (!network.sinks.length) lines.push('这条连接网络没有接收端；检查下游入口、桥接方向和端点连接。')
    lines.push(`接收端格子：${network.sinks.slice(0, 12).join('、') || '无'}。`)
  }
  const priority = obj(data.priority)
  if (typeof priority.value === 'number') lines.push(`当前优先级：${priority.value}（${String(priority.class)}）。这不是无人执行的充分原因；还需检查复制人权限、路径与材料。`)
  lines.push(...suggestions)
  if (!suggestions.length) lines.push('以上是当前对象的事实；还不能确定上游故障原因，不会自动修改基地。')
  return { success: true, reply: lines.join('\n') }
}
