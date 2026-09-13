import type { SkillProgram, SkillRecord, SkillSourceStatement } from './contracts.js'
import { compileSkillSource } from './skill-source.js'
import { validateSkillProgram } from './skill-runtime.js'

export const dependencyKey = (id: string, version: number): string => `${id}@${version}`

export function skillReferences(program: SkillProgram): Array<{ skillId: string, version: number }> {
  if (program.language !== 'xiaotangyuan-skill-v2') return []
  const refs: Array<{ skillId: string, version: number }> = []
  const visit = (body: SkillSourceStatement[]): void => {
    for (const node of body) {
      if (node.kind === 'skill') refs.push({ skillId: node.skillId, version: node.version })
      if (node.kind === 'if') { visit(node.then); visit(node.else ?? []) }
      if (node.kind === 'repeat') visit(node.body)
      if (node.kind === 'try') { visit(node.body); visit(node.fallback) }
    }
  }
  visit(compileSkillSource(program.source).body)
  return refs
}

/** Validate every branch before the first game action, then freeze the run's graph. */
export function snapshotDependencies(rootId: string, program: SkillProgram, atoms: ReadonlySet<string>,
  resolve: (id: string, version: number) => SkillRecord | undefined): Map<string, SkillRecord> {
  const snapshot = new Map<string, SkillRecord>()
  let gameId: string | undefined
  let visits = 0
  const visit = (id: string, current: SkillProgram, path: string[]): void => {
    if (++visits > 128) throw new Error('技能依赖图展开超限')
    if (path.includes(id)) throw new Error('技能不能循环调用或递归：' + [...path, id].join(' → '))
    if (path.length >= 4) throw new Error('技能调用最多 4 层')
    validateSkillProgram(current, atoms)
    for (const ref of skillReferences(current)) {
      const key = dependencyKey(ref.skillId, ref.version)
      const record = snapshot.get(key) ?? resolve(ref.skillId, ref.version)
      if (!record || record.verified !== true || record.id !== ref.skillId || record.version !== ref.version) {
        throw new Error('找不到已验证的技能版本：' + key)
      }
      if (gameId !== undefined && record.gameId !== gameId) throw new Error('禁止跨游戏调用技能')
      gameId = record.gameId
      snapshot.set(key, structuredClone(record))
      if (snapshot.size > 32) throw new Error('技能依赖数量超限')
      visit(record.id, record.program, [...path, id])
    }
  }
  visit(rootId, program, [])
  return snapshot
}
