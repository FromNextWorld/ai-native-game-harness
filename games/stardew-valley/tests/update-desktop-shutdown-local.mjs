import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const repo = fileURLToPath(new URL('../../../', import.meta.url))
const require = createRequire(import.meta.url)
const asar = require(join(repo, 'node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar'))
const target = 'C:/Users/10354/AppData/Local/Programs/AI Native Game Harness/resources/app.asar'
const changed = 'src/dsh-product-runtime.mjs'
const stage = mkdtempSync(join(repo, '.artifacts/desktop-shutdown-update-'))
const normalize = text => text.replace(/\r\n/g, '\n')
const previous = asar.extractFile(target, changed)
const baseline = execFileSync('git', ['show', 'HEAD:apps/desktop/src/dsh-product-runtime.mjs'], { cwd: repo, encoding: 'utf8' })
if (normalize(previous.toString()) !== normalize(baseline)) throw new Error('Installed bridge differs from source baseline; refuse overwrite')
const originalFiles = asar.listPackage(target).map(p => p.replace(/^[/\\]+/, ''))
if (originalFiles.some(p => asar.statFile(target, p).unpacked)) throw new Error('Unpacked archive requires separate preservation')
const backup = join(stage, 'app-original.asar')
copyFileSync(target, backup)
const expanded = join(stage, 'expanded')
asar.extractAll(backup, expanded)
copyFileSync(join(repo, 'apps/desktop/src/dsh-product-runtime.mjs'), join(expanded, changed))
const output = join(stage, 'app-updated.asar')
await asar.createPackage(expanded, output)
for (const file of originalFiles) {
  const stat = asar.statFile(backup, file)
  if (stat.files || stat.link) continue
  const expected = file.replace(/\\/g, '/') === changed ? readFileSync(join(repo, 'apps/desktop', changed)) : asar.extractFile(backup, file)
  if (!expected.equals(asar.extractFile(output, file))) throw new Error(`Unexpected archive file change: ${file}`)
}
const check = execFileSync('powershell.exe', ['-NoProfile', '-Command', "@(Get-Process | Where-Object { $_.ProcessName -match 'Harness|Stardew|SMAPI' }).Count"], { encoding: 'utf8' }).trim()
if (check !== '0') throw new Error('Application/game running: prepared only; not deployed')
try {
  copyFileSync(output, target)
  if (!readFileSync(output).equals(readFileSync(target))) throw new Error('Installed archive mismatch')
} catch (error) { copyFileSync(backup, target); throw error }
console.log(JSON.stringify({ updated: target, onlyChanged: changed, verifiedEntries: originalFiles.length, backup }))
