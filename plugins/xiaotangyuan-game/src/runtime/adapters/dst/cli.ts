import { spawn } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DstTsBridge } from './bridge.js'

/** Installed launcher. Does not edit Steam config or mutate unrelated worlds. */
export async function main(args = process.argv.slice(2)): Promise<void> {
  if (args.includes('--help')) {
    console.log('TS DST 桥接：--game-dir <游戏目录> [--pid <已运行游戏PID> | --launch <游戏可执行文件> ...参数] [--check]')
    return
  }
  const launch = args.indexOf('--launch')
  const options = launch < 0 ? args : args.slice(0, launch)
  const value = (name: string): string | undefined => options.indexOf(name) < 0 ? undefined : options[options.indexOf(name) + 1]
  const directory = value('--game-dir') ?? process.env.DST_GAME_DIR
  if (!directory || !isAbsolute(directory)) throw new Error('请提供真实游戏目录的绝对路径：--game-dir')
  const gameDir = resolve(directory)
  let gatewayUrl = process.env.HARNESS_GATEWAY_URL
  try {
    const env = await readFile(join(gameDir, 'mods', 'dont-starve-ai-mod', '.env'), 'utf8')
    gatewayUrl ??= env.match(/^HARNESS_GATEWAY_URL\s*=\s*([^\r\n]+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '')
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  await access(join(gameDir, 'data'))
  const mod = await readFile(join(gameDir, 'mods', 'dont-starve-ai-mod', 'modmain.lua'), 'utf8')
  if (!mod.includes('dst.find_nearest_entity') || !mod.includes('skill_lease')) throw new Error('Mod 与 TS 桥接协议不匹配；请先配套更新，不能直接替换旧启动器')
  if (options.includes('--check')) { console.log('目录和 Mod 协议检查通过；未启动游戏或连接 Gateway。'); return }
  let pid = Number(value('--pid'))
  let game: ReturnType<typeof spawn> | undefined
  if (launch >= 0) {
    const executable = args[launch + 1]
    if (!executable || !isAbsolute(executable)) throw new Error('--launch 需要游戏可执行文件绝对路径')
    game = spawn(executable, args.slice(launch + 2), { cwd: dirname(executable), shell: false, windowsHide: true, stdio: 'ignore' })
    await new Promise<void>((resolve, reject) => { game!.once('spawn', resolve); game!.once('error', reject) })
    pid = game.pid!
  }
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('请提供真实游戏 PID，或用 --launch 启动游戏')
  try { process.kill(pid, 0) } catch { throw new Error('找不到该游戏进程') }
  const bridge = new DstTsBridge(join(gameDir, 'data', 'unsafedata'), pid, gatewayUrl)
  try {
    await bridge.start()
    console.log('TS 游戏桥接已启动；不需要 Python。退出游戏后自动结束。')
    await new Promise<void>(resolve => {
      const finish = (): void => { clearInterval(timer); process.removeListener('SIGINT', finish); process.removeListener('SIGTERM', finish); resolve() }
      const timer = setInterval(() => { try { process.kill(pid, 0) } catch { finish() } }, 1000)
      process.once('SIGINT', finish); process.once('SIGTERM', finish)
      game?.once('exit', finish)
      if (game?.exitCode !== null && game?.exitCode !== undefined) finish()
    })
  } finally { await bridge.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
}
