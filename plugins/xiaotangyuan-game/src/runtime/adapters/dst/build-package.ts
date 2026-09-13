import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { digest, DST_PACKAGE_MANIFEST, packageFiles, verifyDstPackage, type DstPackageManifest } from '../../../installation/dst-package.js'

/** Build-time only. Copies a standalone Node runtime; no pip/Python or player-side npm install. */
export async function buildDstPackage(modSource: string, destination: string): Promise<void> {
  if (process.platform !== 'win32' || !['x64', 'arm64'].includes(process.arch)) throw new Error('此打包入口目前仅支持 Windows；禁止把 Windows Node 打进 macOS 包')
  const version = (await readFile(join(modSource, 'modinfo.lua'), 'utf8')).match(/^version\s*=\s*"(\d+\.\d+\.\d+)"/m)?.[1]
  if (!version) throw new Error('无法读取 Mod 版本')
  await mkdir(destination) // Deliberately refuse overwriting an existing tree.
  for (const name of ['modinfo.lua', 'modmain.lua', 'anim']) await cp(join(modSource, name), join(destination, name), { recursive: true })
  const runtime = join(destination, 'runtime')
  await mkdir(runtime)
  for (const name of ['cli', 'context', 'bridge', 'gateway-client']) {
    await cp(join(dirname(fileURLToPath(import.meta.url)), `${name}.js`), join(runtime, `${name}.js`))
  }
  await cp(process.execPath, join(runtime, 'node.exe'))
  await cp(join(dirname(process.execPath), 'LICENSE'), join(runtime, 'NODE-LICENSE'))
  await cp(resolve(modSource, '../../..', 'LICENSE'), join(runtime, 'HARNESS-LICENSE'))
  await writeFile(join(runtime, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
  const wsSource = dirname(createRequire(import.meta.url).resolve('ws/package.json'))
  const wsTarget = join(runtime, 'node_modules', 'ws')
  await mkdir(wsTarget, { recursive: true })
  for (const name of ['index.js', 'wrapper.mjs', 'lib', 'package.json', 'LICENSE']) await cp(join(wsSource, name), join(wsTarget, name), { recursive: true })
  const files: DstPackageManifest['files'] = []
  for (const path of await packageFiles(destination)) {
    const bytes = await readFile(join(destination, path))
    files.push({ path, size: bytes.length, sha256: digest(bytes) })
  }
  const manifest: DstPackageManifest = { schemaVersion: 1, runtime: 'typescript-node', version, platform: 'win32', arch: process.arch as 'x64' | 'arm64', nodeVersion: process.version, files }
  await writeFile(join(destination, DST_PACKAGE_MANIFEST), JSON.stringify(manifest, null, 2))
  await verifyDstPackage(destination, version)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [source, target] = process.argv.slice(2)
  if (!source || !target) throw new Error('Usage: build-package.js <game-mod> <new package directory>')
  await buildDstPackage(resolve(source), resolve(target))
}
