import { execFile } from 'node:child_process'
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { applyDontStarveInstaller, inspectDontStarvePath, installDontStarveMod } from '../src/installation/dont-starve-together.js'
import { digest, DST_PACKAGE_MANIFEST, packageFiles, verifyDstPackage } from '../src/installation/dst-package.js'
import { resolveConfig } from '../src/config.js'

const run = promisify(execFile)
const repo = resolve(import.meta.dirname, '../../..')
let root: string
let pristine: string
let version: string
let archive: string

beforeAll(async () => {
  if (process.platform !== 'win32') return
  root = await mkdtemp(join(tmpdir(), 'dst-ts-package-test-'))
  pristine = join(root, 'package')
  await mkdir(pristine)
  await run(process.execPath, [resolve(import.meta.dirname, '../dist/runtime/adapters/dst/build-package.js'),
    join(repo, 'games/dont-starve-together/game-mod'), join(pristine, 'mod')], { windowsHide: true })
  version = JSON.parse(await readFile(join(pristine, 'mod', DST_PACKAGE_MANIFEST), 'utf8')).version
  archive = join(root, 'package.zip')
  const quote = (s: string): string => `'${s.replaceAll("'", "''")}'`
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `Compress-Archive -LiteralPath ${quote(join(pristine, 'mod'))} -DestinationPath ${quote(archive)}`], { windowsHide: true })
}, 60_000)
afterAll(async () => { vi.unstubAllEnvs(); if (root) await rm(root, { recursive: true, force: true }) })

async function fixture(): Promise<{ game: string, mod: string }> {
  const game = await mkdtemp(join(root, '游戏 空格-'))
  await mkdir(join(game, 'data', 'databundles'), { recursive: true })
  await writeFile(join(game, 'data', 'databundles', 'scripts.zip'), 'fake game marker')
  return { game, mod: join(game, 'mods', 'dont-starve-ai-mod') }
}
async function changedPackage(file: string, content: string, updateHash = false): Promise<string> {
  const target = await mkdtemp(join(root, 'variant-'))
  await cp(pristine, target, { recursive: true })
  await writeFile(join(target, 'mod', file), content)
  if (updateHash) {
    const path = join(target, 'mod', DST_PACKAGE_MANIFEST)
    const m = JSON.parse(await readFile(path, 'utf8'))
    Object.assign(m.files.find((f: {path: string}) => f.path === file), { size: Buffer.byteLength(content), sha256: digest(content) })
    await writeFile(path, JSON.stringify(m))
  }
  return target
}

describe.skipIf(process.platform !== 'win32')('formal TS DST package (real bundled Node, fake game only)', () => {
  it('installs the verified archive without Python, activates only game-local settings and produces a launch option', async () => {
    const { game, mod } = await fixture()
    await mkdir(join(game, 'mods'))
    const original = 'ForceEnableMod("some-other-mod")\n'
    await writeFile(join(game, 'mods', 'modsettings.lua'), original)
    const result = await installDontStarveMod(game, { manifestUrl: 'https://unused.invalid', archivePath: archive, archiveVersion: version, archiveSha256: digest(await readFile(archive)) }, AbortSignal.timeout(30_000))
    expect(result.action).toBe('installed')
    expect(result.steamLaunchOption).toContain('node.exe" "')
    expect(result.steamLaunchOption).toContain('--launch %command%')
    expect(await inspectDontStarvePath(game)).toMatchObject({ runtime: 'typescript-node', launcherInstalled: true })
    expect(await readFile(join(game, 'mods', 'modsettings.lua'), 'utf8')).toContain(original)
    expect(await readFile(join(game, 'mods', 'modsettings.lua'), 'utf8')).toContain('ForceEnableMod("dont-starve-ai-mod")')
    expect((await packageFiles(mod)).filter(f => /python|chesterai|\.py$/i.test(f))).toEqual([])
    await verifyDstPackage(mod, version, true)
  }, 40_000)

  it('migrates a same-version Python install; preserves gateway, strips keys, and keeps a recoverable backup', async () => {
    const { game, mod } = await fixture()
    await mkdir(mod, { recursive: true })
    await writeFile(join(mod, 'modinfo.lua'), `version = "${version}"\n`)
    await writeFile(join(mod, 'ChesterAI.exe'), 'old')
    await writeFile(join(mod, '.env'), 'HARNESS_API_KEY=secret\nDST_API_KEY=secret\nHARNESS_GATEWAY_URL=ws://127.0.0.1:12345\n')
    const result = await applyDontStarveInstaller(game, pristine, version, AbortSignal.timeout(15_000))
    expect(result.action).toBe('updated')
    expect(await readFile(join(result.backupPath!, 'ChesterAI.exe'), 'utf8')).toBe('old')
    expect(await readFile(join(mod, '.env'), 'utf8')).toBe('HARNESS_GATEWAY_URL=ws://127.0.0.1:12345\n')
    expect((await applyDontStarveInstaller(game, pristine, version, AbortSignal.timeout(15_000))).action).toBe('kept')
    await writeFile(join(mod, 'runtime', 'cli.js'), 'corrupt')
    expect((await applyDontStarveInstaller(game, pristine, version, AbortSignal.timeout(15_000))).action).toBe('updated')
  }, 40_000)

  it('rejects tampered and unlisted payloads before touching the game', async () => {
    const { game } = await fixture()
    const broken = await changedPackage('runtime/cli.js', 'tampered')
    await expect(applyDontStarveInstaller(game, broken, version, AbortSignal.timeout(15_000))).rejects.toThrow('校验失败')
    const unlisted = await changedPackage('runtime/surprise.js', 'unlisted')
    await expect(applyDontStarveInstaller(game, unlisted, version, AbortSignal.timeout(15_000))).rejects.toThrow('清单之外')
    expect(await readdir(game)).toEqual(['data'])
  })

  it('rejects a wrong platform and traversal manifest before touching the game', async () => {
    const { game } = await fixture()
    const m = JSON.parse(await readFile(join(pristine, 'mod', DST_PACKAGE_MANIFEST), 'utf8'))
    const wrong = await changedPackage(DST_PACKAGE_MANIFEST, JSON.stringify({ ...m, platform: 'darwin' }))
    await expect(applyDontStarveInstaller(game, wrong, version, AbortSignal.timeout(15_000))).rejects.toThrow('不匹配')
    m.files[0].path = '../outside'
    const traversal = await changedPackage(DST_PACKAGE_MANIFEST, JSON.stringify(m))
    await expect(applyDontStarveInstaller(game, traversal, version, AbortSignal.timeout(15_000))).rejects.toThrow('记录无效')
    expect(await readdir(game)).toEqual(['data'])
  })

  it('rolls back both the old launcher and settings if the actual Node self-check fails', async () => {
    const { game, mod } = await fixture()
    await mkdir(mod, { recursive: true })
    await writeFile(join(mod, 'modinfo.lua'), 'version = "0.1.0"')
    await writeFile(join(mod, 'ChesterAI.exe'), 'old working launcher')
    await writeFile(join(game, 'mods', 'modsettings.lua'), '-- original settings')
    const broken = await changedPackage('runtime/cli.js', 'process.exit(9)', true)
    await expect(applyDontStarveInstaller(game, broken, version, AbortSignal.timeout(15_000))).rejects.toThrow()
    expect(await readFile(join(mod, 'ChesterAI.exe'), 'utf8')).toBe('old working launcher')
    expect(await readFile(join(game, 'mods', 'modsettings.lua'), 'utf8')).toBe('-- original settings')
  })

  it('launches a harmless child and exits with no bridge lock left behind', async () => {
    const { game, mod } = await fixture()
    await applyDontStarveInstaller(game, pristine, version, AbortSignal.timeout(15_000))
    const node = join(mod, 'runtime', 'node.exe')
    // Node simulates the game lifetime; no Steam or game process is started.
    await run(node, [join(mod, 'runtime', 'cli.js'), '--game-dir', game, '--launch', node, '-e', 'setTimeout(()=>{},500)'], { timeout: 10_000, windowsHide: true, env: { SystemRoot: process.env.SystemRoot, HARNESS_GATEWAY_URL: 'ws://127.0.0.1:1' } })
    expect((await readdir(join(game, 'data', 'unsafedata'))).filter(f => f.endsWith('.lock'))).toEqual([])
  })

  it('resolves Desktop bundled archive defaults atomically without overriding explicit configuration', () => {
    vi.stubEnv('AGH_DST_ARCHIVE_PATH', archive)
    vi.stubEnv('AGH_DST_ARCHIVE_VERSION', version)
    vi.stubEnv('AGH_DST_ARCHIVE_SHA256', 'a'.repeat(64))
    try {
      expect(resolveConfig({}).installers.dontStarve.archivePath).toBe(archive)
      expect(() => resolveConfig({ installers: { dontStarve: { archiveVersion: '0.1.0' } } })).toThrow('together')
    } finally { vi.unstubAllEnvs() }
  })

  it('rejects canceled installation and refuses automatic downgrade without changing the old Mod', async () => {
    const { game, mod } = await fixture()
    await expect(applyDontStarveInstaller(game, pristine, version, AbortSignal.abort(new Error('user canceled')))).rejects.toThrow('user canceled')
    expect(await readdir(game)).toEqual(['data'])
    await mkdir(mod, { recursive: true })
    await writeFile(join(mod, 'modinfo.lua'), 'version = "99.0.0"')
    await writeFile(join(mod, 'ChesterAI.exe'), 'newer install')
    await expect(applyDontStarveInstaller(game, pristine, version, AbortSignal.timeout(15_000))).rejects.toThrow('不自动降级')
    expect(await readFile(join(mod, 'ChesterAI.exe'), 'utf8')).toBe('newer install')
  })

  it('rejects ZIP traversal in the system extractor before writing any Mod files', async () => {
    const { game } = await fixture()
    const badZip = join(root, 'traversal.zip')
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip=[IO.Compression.ZipFile]::Open($env:TEST_ZIP,'Create'); try { $entry=$zip.CreateEntry('../escaped.txt'); $stream=$entry.Open(); $stream.Dispose() } finally { $zip.Dispose() }`],
    { windowsHide: true, env: { SystemRoot: process.env.SystemRoot, TEST_ZIP: badZip } })
    await expect(installDontStarveMod(game, { manifestUrl: 'https://unused.invalid', archivePath: badZip, archiveVersion: version, archiveSha256: digest(await readFile(badZip)) }, AbortSignal.timeout(15_000))).rejects.toThrow('Unsafe archive path')
    expect(await readdir(game)).toEqual(['data'])
  })
})
