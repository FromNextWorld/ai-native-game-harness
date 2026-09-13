import { createHash } from 'node:crypto'
import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { join, basename } from 'node:path'

// A version can stay the same across a hot-update, including packaged apps.
export function pluginFingerprint(path, version) {
  return `${version}:${createHash('sha256').update(readFileSync(path)).digest('hex')}`
}

export function contentAddressedArchive(path, cacheRoot) {
  const bytes = readFileSync(path)
  const digest = createHash('sha256').update(bytes).digest('hex')
  mkdirSync(cacheRoot, { recursive: true })
  const target = join(cacheRoot, `${basename(path, '.tgz')}-${digest}.tgz`)
  if (existsSync(target)) {
    if (!readFileSync(target).equals(bytes)) throw new Error('插件缓存校验失败，请修复缓存后重试。')
  } else {
    const temporary = `${target}.${process.pid}.tmp`
    writeFileSync(temporary, bytes, { flag: 'wx' })
    renameSync(temporary, target)
  }
  return target
}
