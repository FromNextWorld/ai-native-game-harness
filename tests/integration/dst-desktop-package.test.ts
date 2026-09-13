import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error Desktop's native module is JavaScript.
import { bundledDstEnvironment } from '../../apps/desktop/src/dst-installer.mjs'

const roots: string[] = []
const metadata = { version: '0.2.23', archive: 'dsh-xiaotangyuan-game-dont-starve-0.2.23.zip', sha256: 'a'.repeat(64), platform: process.platform, arch: process.arch }
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dst-desktop-assets-'))
  roots.push(root)
  return root
}
describe('Desktop bundled DST wiring', () => {
  it('requires assets in packaged builds but tolerates an unprepared development checkout', async () => {
    const root = await fixture()
    expect(bundledDstEnvironment(root)).toEqual({})
    expect(() => bundledDstEnvironment(root, { required: true })).toThrow('缺失')
    await writeFile(join(root, 'bundle.json'), JSON.stringify(metadata))
    expect(() => bundledDstEnvironment(root)).toThrow('文件缺失')
    await writeFile(join(root, metadata.archive), 'fixture, checksum tested separately by installer')
    expect(bundledDstEnvironment(root)).toEqual({ AGH_DST_ARCHIVE_PATH: join(root, metadata.archive), AGH_DST_ARCHIVE_VERSION: metadata.version, AGH_DST_ARCHIVE_SHA256: metadata.sha256 })
  })
  it('rejects path injection, version mismatch, bad hashes, and cross-platform bundles', async () => {
    const root = await fixture()
    for (const changed of [{ archive: '../outside.zip' }, { version: '0.3.0' }, { sha256: 'invalid' }, { platform: 'unsupported' }]) {
      await writeFile(join(root, 'bundle.json'), JSON.stringify({ ...metadata, ...changed }))
      expect(() => bundledDstEnvironment(root)).toThrow('无效或平台不匹配')
    }
  })
  it('stages only metadata and zip, and supplies the verified local defaults to DSH', async () => {
    const repo = resolve(import.meta.dirname, '../..')
    const builder = await readFile(join(repo, 'apps/desktop/electron-builder.config.mjs'), 'utf8')
    expect(builder).toContain("to: 'game-installers/dont-starve-together'")
    expect(builder).toContain("filter: ['bundle.json', '*.zip']")
    const main = await readFile(join(repo, 'apps/desktop/src/main.mjs'), 'utf8')
    expect(main).toContain('bundledDstEnvironment(dstRoot, { required: app.isPackaged })')
    expect(main).toContain('...dstEnv,')
    const prepare = await readFile(join(repo, 'scripts/prepare-desktop-runtime.ps1'), 'utf8')
    expect(prepare).toContain('games/dont-starve-together/scripts/build-player-package.ps1')
    for (const entry of ['scripts/prepare-desktop-dev.ps1', 'scripts/integrate-xiaotangyuan-plugin.ps1']) {
      expect(await readFile(join(repo, entry), 'utf8')).toContain('games/dont-starve-together/scripts/build-player-package.ps1')
    }
  })
})
