import type { SkillAcceptance } from '../skills/contracts.js'

/** Task policy belongs above the generic skill runtime. No skill code is bundled here. */
export function huntTaskAcceptance(targetPrefab: string, itemPrefabs: string[]): SkillAcceptance {
  return { version: 1, steps: [
    { atom: 'dst.find_nearest_entity', arguments: { prefab: targetPrefab }, equals: { prefab: targetPrefab }, positive: ['targetId'] },
    { atom: 'dst.attack_target', equals: { defeated: true }, bindings: { targetId: { step: 0, field: 'targetId' } },
      resultBindings: { targetId: { step: 0, field: 'targetId' } }, positive: ['targetId'] },
    { atom: 'dst.collect_items', arguments: { prefabs: itemPrefabs }, positive: ['count'], nonEmpty: ['items'],
      bindings: { x: { step: 1, field: 'x' }, z: { step: 1, field: 'z' } }, allowedItems: { items: itemPrefabs } },
  ] }
}

export function acceptanceForGameTask(gameId: string | undefined, playerText: string): SkillAcceptance | undefined {
  // First supported task policy, NOT a restriction on every skill in this game.
  if (gameId === 'dont-starve-together' && /蝴蝶|butterfly/i.test(playerText)
    && /学习|学会|练习|\blearn\b/i.test(playerText)) {
    return huntTaskAcceptance('butterfly', ['butterflywings', 'butter'])
  }
  return undefined
}
