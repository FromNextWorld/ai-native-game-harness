import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// DSH runs in a separate Node process and cannot load packages inside app.asar.
// Resolve by package name: DSH's client discovery looks up <name>/package.json.
// userData is an ancestor of dsh-home/profiles/web, so normal Node resolution
// finds this package without editing the user's profile or its dependencies.
export function stageGameUiPlugin(sourceRoot, userData) {
  const target = join(userData, 'node_modules', '@ai-native-game-harness', 'desktop-game-ui')
  mkdirSync(target, { recursive: true })
  for (const file of ['package.json', 'index.mjs', 'client.js']) {
    const content = readFileSync(join(sourceRoot, file))
    let existing
    try { existing = readFileSync(join(target, file)) } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (!existing?.equals(content)) writeFileSync(join(target, file), content)
  }
  return `- insert:\n    - id: agh-desktop-game-ui\n      name: '@ai-native-game-harness/desktop-game-ui'\n`
}
