import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

export const DST_PACKAGE_MANIFEST = 'dst-runtime.json'
export interface DstPackageManifest {
  schemaVersion: 1
  runtime: 'typescript-node'
  version: string
  platform: 'win32'
  arch: 'x64' | 'arm64'
  nodeVersion: string
  files: { path: string, size: number, sha256: string }[]
}
export const digest = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')

/** Applies even to files correctly listed/hashed in a package manifest. */
export function assertPythonFreePayload(paths: readonly string[]): void {
  for (const path of paths) {
    if (/(?:^|[\\/])(?:chesterai\.exe|python(?:w|\d+(?:\.\d+)*)?(?:\.exe|\.dll)?|libpython[^\\/]*|pyinstaller|__pycache__|\.venv)(?:[\\/]|$)|\.(?:py|pyc|pyo|pyd|pyz)$/i.test(path)) {
      throw new Error(`饥荒正式包禁止包含旧 Python 运行依赖：${path}`)
    }
  }
}

/** No links, alternate streams, traversal, or unlisted executable payloads. */
export async function packageFiles(root: string, prefix = ''): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = `${prefix}${entry.name}`
    if (!/^[a-zA-Z0-9_./@-]+$/.test(path) || entry.isSymbolicLink()) throw new Error('饥荒安装包包含不安全路径')
    if (entry.isDirectory()) result.push(...await packageFiles(root, `${path}/`))
    else if (entry.isFile()) result.push(path)
    else throw new Error('饥荒安装包包含非普通文件')
  }
  return result.sort()
}

export async function verifyDstPackage(root: string, expectedVersion: string, installed = false): Promise<DstPackageManifest> {
  const raw = await readFile(join(root, DST_PACKAGE_MANIFEST), 'utf8')
  if (raw.length > 256_000) throw new Error('饥荒运行时清单过大')
  const m = JSON.parse(raw) as DstPackageManifest
  if (m.schemaVersion !== 1 || m.runtime !== 'typescript-node' || m.version !== expectedVersion
    || !/^\d+\.\d+\.\d+$/.test(m.version) || !/^v\d+\.\d+\.\d+$/.test(m.nodeVersion)) throw new Error('饥荒 TS 运行时清单无效')
  if (m.platform !== process.platform || m.arch !== process.arch) throw new Error('饥荒安装包与当前操作系统或架构不匹配')
  if (!Array.isArray(m.files) || m.files.length < 8 || m.files.length > 512) throw new Error('饥荒安装包文件清单无效')
  assertPythonFreePayload(m.files.map(file => file.path))
  const seen = new Set<string>()
  let total = 0
  for (const f of m.files) {
    if (typeof f.path !== 'string' || !/^[a-zA-Z0-9_./@-]+$/.test(f.path)
      || f.path.split('/').some(part => part === '' || part === '.' || part === '..')
      || f.path === DST_PACKAGE_MANIFEST || seen.has(f.path.toLowerCase())
      || !Number.isSafeInteger(f.size) || f.size < 0 || !/^[a-f0-9]{64}$/.test(f.sha256)) throw new Error('饥荒安装包文件记录无效')
    seen.add(f.path.toLowerCase())
    total += f.size
    if (total > 256 * 1024 * 1024) throw new Error('饥荒安装包解压后过大')
    const details = await lstat(join(root, f.path))
    if (!details.isFile() || details.isSymbolicLink() || details.size !== f.size
      || digest(await readFile(join(root, f.path))) !== f.sha256) throw new Error(`饥荒安装包文件校验失败：${f.path}`)
  }
  const actual = (await packageFiles(root)).filter(path => !installed || !['.env', 'Steam-Launch-Option.txt'].includes(path))
  const expected = [...m.files.map(f => f.path), DST_PACKAGE_MANIFEST].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('饥荒安装包含清单之外的文件')
  for (const required of ['modinfo.lua', 'modmain.lua', 'anim/jingling.zip', 'runtime/node.exe', 'runtime/cli.js',
    'runtime/context.js', 'runtime/bridge.js', 'runtime/gateway-client.js', 'runtime/package.json', 'runtime/NODE-LICENSE',
    'runtime/node_modules/ws/package.json', 'runtime/node_modules/ws/LICENSE']) {
    if (!seen.has(required.toLowerCase())) throw new Error(`饥荒安装包缺少 ${required}`)
  }
  return m
}

export function dstLaunchOption(game: string, mod: string): string {
  if (/["\r\n%]/.test(game + mod)) throw new Error('游戏目录包含启动项不支持的字符，请换一个目录')
  return `"${join(mod, 'runtime', 'node.exe')}" "${join(mod, 'runtime', 'cli.js')}" --game-dir "${game}" --launch %command%`
}
