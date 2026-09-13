import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function bundledDstEnvironment(root, { required = false, platform = process.platform, arch = process.arch } = {}) {
  const metadata = join(root, 'bundle.json')
  if (!existsSync(metadata)) {
    if (required) throw new Error('内置饥荒安装包缺失，请修复应用安装')
    return {}
  }
  const bundle = JSON.parse(readFileSync(metadata, 'utf8'))
  if (!/^\d+\.\d+\.\d+$/.test(bundle.version)
    || bundle.archive !== `dsh-xiaotangyuan-game-dont-starve-${bundle.version}.zip`
    || !/^[a-f0-9]{64}$/.test(bundle.sha256) || bundle.platform !== platform || bundle.arch !== arch) {
    throw new Error('内置饥荒安装包信息无效或平台不匹配')
  }
  const path = join(root, bundle.archive)
  if (!existsSync(path)) throw new Error('内置饥荒安装包文件缺失，请修复应用安装')
  // Content hash is checked by the installer immediately before extraction, not on each Runtime fork.
  return { AGH_DST_ARCHIVE_PATH: path, AGH_DST_ARCHIVE_VERSION: bundle.version, AGH_DST_ARCHIVE_SHA256: bundle.sha256 }
}
