import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pluginFingerprint, contentAddressedArchive } from '../../apps/desktop/src/plugin-fingerprint.mjs'
import { treeHashes, assertSameTree } from '../../scripts/release-source.mjs'

describe('source release drift guards', () => {
  it('gives same-version tarballs different install URLs and rejects corrupt cache', () => {
    const root = mkdtempSync(join(tmpdir(), 'release-archive-'))
    try {
      const file = join(root, 'plugin-0.7.9.tgz'), cache = join(root, 'cache')
      writeFileSync(file, 'old'); const old = contentAddressedArchive(file, cache)
      expect(contentAddressedArchive(file, cache)).toBe(old)
      writeFileSync(file, 'new'); const next = contentAddressedArchive(file, cache)
      expect(next).not.toBe(old)
      writeFileSync(next, 'corrupt')
      expect(() => contentAddressedArchive(file, cache)).toThrow('缓存校验失败')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('changes fingerprint for same-version hot updates', () => {
    const root = mkdtempSync(join(tmpdir(), 'release-fingerprint-'))
    try {
      const file = join(root, 'plugin.tgz'); writeFileSync(file, 'old')
      const before = pluginFingerprint(file, '0.7.9')
      writeFileSync(file, 'new')
      expect(pluginFingerprint(file, '0.7.9')).not.toBe(before)
      expect(pluginFingerprint(file, '0.7.9')).toMatch(/^0\.7\.9:[a-f0-9]{64}$/)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('rejects changed and extra payload files, not just version mismatches', () => {
    const root = mkdtempSync(join(tmpdir(), 'release-payload-'))
    try {
      const file = join(root, 'index.js'); writeFileSync(file, 'export default 1')
      const expected = treeHashes(root)
      expect(() => assertSameTree(root, expected)).not.toThrow()
      writeFileSync(file, 'export default 2')
      expect(() => assertSameTree(root, expected)).toThrow('Payload changed')
      writeFileSync(file, 'export default 1'); writeFileSync(join(root, 'stale.js'), 'old')
      expect(() => assertSameTree(root, expected)).toThrow('Payload changed')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
