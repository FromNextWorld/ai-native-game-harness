import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  access,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import extract from 'extract-zip'
import type { ResolvedConfig } from '../config.js'
import { compareStableVersions, steamRoots } from './stardew-valley.js'
import { DST_PACKAGE_MANIFEST, dstLaunchOption, verifyDstPackage } from './dst-package.js'

const execFileAsync = promisify(execFile)
const GAME_FOLDER = "Don't Starve Together"
const MOD_FOLDER = 'dont-starve-ai-mod'
const LAUNCHER_NAME = 'ChesterAI.exe'
const PACKAGED_INSTALLER_NAME = '安装切斯特AI.exe'
const RELEASE_PREFIX = 'https://github.com/qimidandapigu/dsh-xiaotangyuan-game/releases/download/'
const ASSET_PREFIX = 'dsh-xiaotangyuan-game-dont-starve-'
const MAX_ARCHIVE_SIZE = 100 * 1024 * 1024

export interface DontStarveArchiveSpec {
  name: string
  url: string
  size: number
  sha256: string
}

export interface DontStarveDistributionManifest {
  schemaVersion: 1
  tag: string
  version: string
  archive: DontStarveArchiveSpec
}

export interface DontStarveDetection {
  found: boolean
  platform: NodeJS.Platform
  gamePath?: string
  modsPath?: string
  modPath?: string
  installedVersion?: string
  launcherInstalled: boolean
  runtime?: 'typescript-node' | 'legacy-python'
  steamLaunchOption?: string
}

export interface DontStarveInstallResult {
  installed: true
  gameId: 'dont-starve-together'
  version: string
  gamePath: string
  modPath: string
  action: 'installed' | 'updated' | 'kept'
  backupPath?: string
  steamLaunchOption: string
  components: string
}

export type DontStarveInstallerRunner = (installerPath: string, gamePath: string, signal: AbortSignal) => Promise<void>

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function numericVersion(value: string): readonly number[] | undefined {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)$/)
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])]
}

function safeChild(parent: string, child: string): void {
  const fromParent = relative(resolve(parent), resolve(child))
  if (fromParent === '' || fromParent.startsWith('..') || isAbsolute(fromParent)) {
    throw new Error(`refusing unsafe Don't Starve Together destination: ${child}`)
  }
}

function parseInstalledVersion(text: string): string | undefined {
  return text.match(/^\s*version\s*=\s*["']([^"']+)["']/m)?.[1]?.trim()
}

async function readInstalledVersion(modPath: string): Promise<string | undefined> {
  try {
    return parseInstalledVersion(await readFile(join(modPath, 'modinfo.lua'), 'utf8'))
  } catch {
    return undefined
  }
}

export async function inspectDontStarvePath(gamePath: string): Promise<DontStarveDetection | undefined> {
  const resolved = resolve(gamePath)
  if (!(await exists(join(resolved, 'data', 'databundles', 'scripts.zip')))) return undefined
  const modsPath = join(resolved, 'mods')
  const modPath = join(modsPath, MOD_FOLDER)
  const installedVersion = await readInstalledVersion(modPath)
  const launcherPath = join(modPath, LAUNCHER_NAME)
  const tsInstalled = await exists(join(modPath, DST_PACKAGE_MANIFEST))
    && await exists(join(modPath, 'runtime', 'node.exe')) && await exists(join(modPath, 'runtime', 'cli.js'))
  const launcherInstalled = tsInstalled || await exists(launcherPath)
  return {
    found: true,
    platform: process.platform,
    gamePath: resolved,
    modsPath,
    modPath,
    launcherInstalled,
    ...(launcherInstalled ? { runtime: tsInstalled ? 'typescript-node' as const : 'legacy-python' as const } : {}),
    ...(installedVersion === undefined ? {} : { installedVersion }),
    ...(launcherInstalled ? { steamLaunchOption: tsInstalled ? dstLaunchOption(resolved, modPath) : `"${launcherPath}" %command%` } : {}),
  }
}

export async function detectDontStarve(
  gamePath?: string,
  signal?: AbortSignal,
): Promise<DontStarveDetection> {
  signal?.throwIfAborted()
  if (gamePath !== undefined && gamePath.trim() !== '') {
    return await inspectDontStarvePath(gamePath.trim())
      ?? { found: false, platform: process.platform, launcherInstalled: false }
  }
  for (const root of await steamRoots(signal)) {
    signal?.throwIfAborted()
    const detection = await inspectDontStarvePath(join(root, 'steamapps', 'common', GAME_FOLDER))
    if (detection !== undefined) return detection
  }
  return { found: false, platform: process.platform, launcherInstalled: false }
}

export function parseDontStarveDistributionManifest(value: unknown): DontStarveDistributionManifest {
  if (typeof value !== 'object' || value === null) throw new Error('饥荒发布清单不是对象')
  const manifest = value as Partial<DontStarveDistributionManifest>
  if (manifest.schemaVersion !== 1) throw new Error('饥荒发布清单版本不受支持')
  if (typeof manifest.version !== 'string' || numericVersion(manifest.version) === undefined) {
    throw new Error('饥荒发布清单包含无效版本')
  }
  if (manifest.tag !== `dont-starve-v${manifest.version}`) throw new Error('饥荒发布标签与版本不一致')
  if (typeof manifest.archive !== 'object' || manifest.archive === null) throw new Error('饥荒发布清单缺少安装包')
  const archive = manifest.archive as Partial<DontStarveArchiveSpec>
  const expectedName = `${ASSET_PREFIX}${manifest.version}.zip`
  if (archive.name !== expectedName) throw new Error('饥荒安装包名称无效')
  if (archive.url !== `${RELEASE_PREFIX}${manifest.tag}/${expectedName}`) throw new Error('饥荒安装包不是官方发布地址')
  if (!Number.isSafeInteger(archive.size) || archive.size! <= 0 || archive.size! > MAX_ARCHIVE_SIZE) {
    throw new Error('饥荒安装包大小无效')
  }
  if (typeof archive.sha256 !== 'string' || !/^[a-fA-F0-9]{64}$/.test(archive.sha256)) {
    throw new Error('饥荒安装包 SHA-256 无效')
  }
  return {
    schemaVersion: 1,
    tag: manifest.tag,
    version: manifest.version,
    archive: {
      name: archive.name,
      url: archive.url,
      size: archive.size!,
      sha256: archive.sha256.toLowerCase(),
    },
  }
}

async function fetchManifest(url: string, signal: AbortSignal): Promise<DontStarveDistributionManifest> {
  const response = await fetch(url, {
    signal,
    headers: { Accept: 'application/json', 'User-Agent': 'dsh-xiaotangyuan-game' },
  })
  if (!response.ok) throw new Error(`无法读取饥荒发布清单：HTTP ${response.status}`)
  return parseDontStarveDistributionManifest(await response.json())
}

async function verifiedArchive(
  config: ResolvedConfig['installers']['dontStarve'],
  signal: AbortSignal,
): Promise<{ bytes: Uint8Array, version: string }> {
  let bytes: Uint8Array
  let version: string
  let expectedSha256: string
  let expectedSize: number | undefined
  if (config.archivePath !== undefined) {
    const details = await stat(config.archivePath)
    if (!details.isFile() || details.size <= 0 || details.size > MAX_ARCHIVE_SIZE) {
      throw new Error('本地饥荒安装包大小无效')
    }
    bytes = new Uint8Array(await readFile(config.archivePath))
    version = config.archiveVersion!
    expectedSha256 = config.archiveSha256!
  } else {
    const manifest = await fetchManifest(config.manifestUrl, signal)
    const response = await fetch(manifest.archive.url, {
      signal,
      headers: { Accept: 'application/octet-stream', 'User-Agent': 'dsh-xiaotangyuan-game' },
    })
    if (!response.ok) throw new Error(`下载饥荒安装包失败：HTTP ${response.status}`)
    bytes = new Uint8Array(await response.arrayBuffer())
    version = manifest.version
    expectedSha256 = manifest.archive.sha256
    expectedSize = manifest.archive.size
  }
  if (bytes.byteLength > MAX_ARCHIVE_SIZE) throw new Error('饥荒安装包超过大小限制')
  if (expectedSize !== undefined && bytes.byteLength !== expectedSize) throw new Error('饥荒安装包大小与清单不一致')
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== expectedSha256) throw new Error(`饥荒安装包校验失败：expected ${expectedSha256}, received ${actual}`)
  return { bytes, version }
}

function sanitizedAdapterEnv(text: string): string {
  const allowed = /^(HARNESS_GATEWAY_URL|DST_GAME_DIR)=/
  const lines = text.split(/\r?\n/).filter(line => allowed.test(line.trim()))
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}

async function availableBackupPath(root: string, base: string): Promise<string> {
  const initial = join(root, base)
  if (!(await exists(initial))) return initial
  for (let index = 1; index <= 1000; index += 1) {
    const candidate = join(root, `${base}-${index}`)
    if (!(await exists(candidate))) return candidate
  }
  throw new Error('无法创建唯一的饥荒 Mod 备份目录')
}

async function defaultRunner(installerPath: string, gamePath: string, signal: AbortSignal): Promise<void> {
  await execFileAsync(installerPath, ['--install'], {
    encoding: 'utf8',
    env: { ...process.env, DST_GAME_DIR: gamePath },
    windowsHide: true,
    signal,
  })
}

export async function applyDontStarveInstaller(
  gamePath: string,
  installerRoot: string,
  version: string,
  signal: AbortSignal,
  runner: DontStarveInstallerRunner = defaultRunner,
): Promise<DontStarveInstallResult> {
  signal.throwIfAborted()
  const detection = await inspectDontStarvePath(gamePath)
  if (detection?.gamePath === undefined || detection.modsPath === undefined || detection.modPath === undefined) {
    throw new Error('指定目录不是有效的《饥荒联机版》安装目录')
  }
  const installerPath = join(installerRoot, PACKAGED_INSTALLER_NAME)
  const tsRoot = join(installerRoot, 'mod')
  const tsPackage = await exists(join(tsRoot, DST_PACKAGE_MANIFEST))
    ? await verifyDstPackage(tsRoot, version) : undefined
  if (!tsPackage && !(await exists(installerPath))) throw new Error('饥荒安装包缺少 TS 运行时或旧版安装器')
  if (detection.installedVersion && (compareStableVersions(detection.installedVersion, version) ?? 0) > 0) {
    throw new Error('已安装更新版本的饥荒 Mod，不自动降级；请使用匹配的新安装包')
  }
  let sameTsBuild = false
  if (tsPackage && detection.runtime === 'typescript-node') {
    try {
      const installed = await verifyDstPackage(detection.modPath, detection.installedVersion!, true)
      const settings = await readFile(join(detection.modsPath, 'modsettings.lua'), 'utf8')
      sameTsBuild = JSON.stringify(installed) === JSON.stringify(tsPackage)
        && /^\s*ForceEnableMod\("dont-starve-ai-mod"\)\s*$/m.test(settings)
    } catch { /* Repair incomplete or changed builds, even at the same semantic version. */ }
  }
  if (detection.installedVersion !== undefined
    && detection.launcherInstalled
    && (tsPackage ? sameTsBuild : detection.runtime === 'legacy-python')
    && (compareStableVersions(detection.installedVersion, version) ?? -1) >= 0) {
    return {
      installed: true,
      gameId: 'dont-starve-together',
      version: detection.installedVersion,
      gamePath: detection.gamePath,
      modPath: detection.modPath,
      action: 'kept',
      steamLaunchOption: detection.steamLaunchOption!,
      components: tsPackage ? 'DST Lua Mod + TypeScript Adapter + bundled Node' : 'DST Lua Mod + legacy Python launcher',
    }
  }

  safeChild(detection.gamePath, detection.modPath)
  // Reject junctions before any backup or replacement, including a redirected mods folder.
  for (const path of [detection.modsPath, detection.modPath]) {
    if (await exists(path) && (await lstat(path)).isSymbolicLink()) throw new Error('游戏 Mod 目录是链接，请先确认真实安装目录')
  }
  const backupRoot = join(detection.gamePath, '.xiaotangyuan-backups')
  safeChild(detection.gamePath, backupRoot)
  if (await exists(backupRoot) && (await lstat(backupRoot)).isSymbolicLink()) throw new Error('备份目录是链接，已停止安装')
  await mkdir(backupRoot, { recursive: true })
  let previousEnv = ''
  try {
    previousEnv = sanitizedAdapterEnv(await readFile(join(detection.modPath, '.env'), 'utf8'))
  } catch {
    // A previous installation may not have Adapter configuration.
  }
  const settingsPath = join(detection.modsPath, 'modsettings.lua')
  if (await exists(settingsPath) && (await lstat(settingsPath)).isSymbolicLink()) throw new Error('Mod 设置文件是链接，已停止安装')
  const previousSettings = await exists(settingsPath) ? await readFile(settingsPath, 'utf8') : undefined
  let settingsChanged = false
  let backupPath: string | undefined
  if (await exists(detection.modPath)) {
    const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
    backupPath = await availableBackupPath(backupRoot, `${MOD_FOLDER}.backup-${timestamp}`)
    safeChild(backupRoot, backupPath)
    await rename(detection.modPath, backupPath)
  }

  try {
    signal.throwIfAborted()
    if (tsPackage) {
      await cp(tsRoot, detection.modPath, { recursive: true, errorOnExist: true, force: false })
      await verifyDstPackage(detection.modPath, version)
      await execFileAsync(join(detection.modPath, 'runtime', 'node.exe'), [join(detection.modPath, 'runtime', 'cli.js'), '--game-dir', detection.gamePath, '--check'], {
        signal, windowsHide: true, timeout: 15_000,
        env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: process.env.TEMP, TMP: process.env.TMP },
      })
      const option = dstLaunchOption(detection.gamePath, detection.modPath)
      await writeFile(join(detection.modPath, 'Steam-Launch-Option.txt'), `${option}\n`, 'utf8')
      const original = previousSettings ?? ''
      // Game-local activation only; do not scan or mutate unrelated user worlds.
      const enabled = /^\s*ForceEnableMod\("dont-starve-ai-mod"\)\s*$/m.test(original)
      if (!enabled) {
        settingsChanged = true
        await writeFile(settingsPath, `${original}\nForceEnableMod("dont-starve-ai-mod")\nDisableLocalModWarning()\n`, 'utf8')
      }
    } else await runner(installerPath, detection.gamePath, signal)
    signal.throwIfAborted()
    const installed = await inspectDontStarvePath(detection.gamePath)
    if (installed?.installedVersion !== version || !installed.launcherInstalled || installed.modPath === undefined) {
      throw new Error(`饥荒 Mod 安装后验证失败，期望版本 ${version}`)
    }
    if (previousEnv !== '') await writeFile(join(installed.modPath, '.env'), previousEnv, 'utf8')
    return {
      installed: true,
      gameId: 'dont-starve-together',
      version,
      gamePath: installed.gamePath!,
      modPath: installed.modPath,
      action: backupPath === undefined ? 'installed' : 'updated',
      ...(backupPath === undefined ? {} : { backupPath }),
      steamLaunchOption: installed.steamLaunchOption!,
      components: tsPackage ? 'DST Lua Mod + TypeScript Adapter + bundled Node' : 'DST Lua Mod + legacy Python launcher',
    }
  } catch (error) {
    if (settingsChanged) {
      if (previousSettings === undefined) await rm(settingsPath, { force: true })
      else await writeFile(settingsPath, previousSettings, 'utf8')
    }
    await rm(detection.modPath, { recursive: true, force: true })
    if (backupPath !== undefined && await exists(backupPath)) await rename(backupPath, detection.modPath)
    throw error
  }
}

/** extract-zip's legacy streams can stall on Node 26. Windows uses bounded .NET extraction. */
async function extractDstArchive(archivePath: string, destination: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  if (process.platform !== 'win32') {
    await extract(archivePath, { dir: destination })
    return
  }
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = [IO.Path]::GetFullPath($env:AGH_EXTRACT_DEST) + [IO.Path]::DirectorySeparatorChar
$zip = [IO.Compression.ZipFile]::OpenRead($env:AGH_EXTRACT_ZIP)
try {
  if ($zip.Entries.Count -gt 600) { throw 'Too many archive entries' }
  $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  [long]$size = 0
  foreach ($entry in $zip.Entries) {
    $name = $entry.FullName.Replace('\\', '/')
    if ($name -match '(^/|:|(^|/)\\.\\.?(/|$))' -or (($entry.ExternalAttributes -shr 16) -band 61440) -eq 40960) { throw 'Unsafe archive path or link' }
    $target = [IO.Path]::GetFullPath([IO.Path]::Combine($root, $name))
    if (-not $target.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or -not $seen.Add($target)) { throw 'Unsafe or duplicate archive path' }
    $size += $entry.Length
    if ($size -gt 268435456) { throw 'Unpacked archive too large' }
  }
} finally { $zip.Dispose() }
[IO.Compression.ZipFile]::ExtractToDirectory($env:AGH_EXTRACT_ZIP, $env:AGH_EXTRACT_DEST)
`
  await execFileAsync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', script], {
      signal, timeout: 60_000, windowsHide: true,
      env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: process.env.TEMP, TMP: process.env.TMP,
        AGH_EXTRACT_ZIP: archivePath, AGH_EXTRACT_DEST: destination },
    })
  signal.throwIfAborted()
}

export async function installDontStarveMod(
  gamePath: string | undefined,
  config: ResolvedConfig['installers']['dontStarve'],
  signal: AbortSignal,
): Promise<DontStarveInstallResult> {
  const detection = await detectDontStarve(gamePath, signal)
  if (!detection.found || detection.gamePath === undefined) {
    throw new Error('没有找到《饥荒联机版》，请通过 gamePath 提供游戏安装目录')
  }
  const archive = await verifiedArchive(config, signal)
  const tempRoot = await mkdtemp(join(tmpdir(), 'dsh-dont-starve-'))
  try {
    const archivePath = join(tempRoot, 'package.zip')
    const extractedPath = join(tempRoot, 'package')
    await writeFile(archivePath, archive.bytes)
    await mkdir(extractedPath)
    await extractDstArchive(archivePath, extractedPath, signal)
    return await applyDontStarveInstaller(detection.gamePath, extractedPath, archive.version, signal)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}
