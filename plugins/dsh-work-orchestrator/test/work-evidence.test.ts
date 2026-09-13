import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { captureWorkFiles, evidenceStatements } from '../src/work-evidence.js'
import { verifyWorkExecution } from '../src/work-orchestrator-service.js'

function events(name: string, args: unknown) {
  return [
    { seq: 0, time: Date.now(), type: 'tool/call', data: { callId: 'one', name, arguments: JSON.stringify(args) } },
    { seq: 1, time: Date.now(), type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: 'one', isError: false }] } } },
  ] as never
}
describe('work evidence cannot use non-executed text', () => {
  it.each([
    "# Set-Content 'old.md'; Start-Process 'old.md'",
    "Write-Output \"Set-Content 'old.md'; Start-Process 'old.md'\"",
    "<# Set-Content 'old.md'; Start-Process 'old.md' #>",
    "if ($false) { Set-Content 'old.md'; Start-Process 'old.md' }",
    "@'\nSet-Content 'old.md'; Start-Process 'old.md'\n'@",
  ])('rejects inert or conditional command %s', command => {
    const root = mkdtempSync(join(tmpdir(), 'work-evidence-'))
    try {
      writeFileSync(join(root, 'old.md'), '# Existing file')
      expect(() => verifyWorkExecution(events('pwsh', { command }), 0, root, '生成 Markdown 并打开')).toThrow()
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('requires actual file change in this turn, not only a successful tool receipt', () => {
    const root = mkdtempSync(join(tmpdir(), 'work-evidence-'))
    const path = join(root, 'old.md')
    try {
      writeFileSync(path, '# Existing file')
      const before = captureWorkFiles(root)
      expect(() => verifyWorkExecution(events('write', { file_path: path }), 0, root, '生成 Markdown', before)).toThrow()
      writeFileSync(path, '# Newly generated content, different size')
      expect(verifyWorkExecution(events('write', { file_path: path }), 0, root, '生成 Markdown', before).artifactPaths).toEqual([path])
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('keeps quoted semicolons and strips comments without treating them as commands', () => {
    expect(evidenceStatements("# note\nStart-Process 'a;b.md' # comment\n")).toEqual(["Start-Process 'a;b.md'"])
  })
  it('rejects a linked directory that the snapshot deliberately skipped', () => {
    const root = mkdtempSync(join(tmpdir(), 'work-evidence-'))
    try {
      mkdirSync(join(root, 'actual'))
      writeFileSync(join(root, 'actual', 'old.md'), '# Existing file')
      symlinkSync(join(root, 'actual'), join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir')
      const before = captureWorkFiles(root)
      expect(() => verifyWorkExecution(events('write', { path: join(root, 'alias', 'old.md') }), 0, root, '生成 Markdown', before)).toThrow()
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it.skipIf(process.platform !== 'win32')('does not mistake Windows path casing for a newly created file', () => {
    const root = mkdtempSync(join(tmpdir(), 'work-evidence-'))
    try {
      writeFileSync(join(root, 'Old.md'), '# Existing file')
      const before = captureWorkFiles(root)
      expect(() => verifyWorkExecution(events('write', { path: join(root, 'OLD.MD') }), 0, root, '生成 Markdown', before)).toThrow()
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('rejects WhatIf as an actual open', () => {
    const root = mkdtempSync(join(tmpdir(), 'work-evidence-'))
    try {
      writeFileSync(join(root, 'old.md'), '# Existing file')
      expect(() => verifyWorkExecution(events('pwsh', { command: "Start-Process 'old.md' -WhatIf" }), 0, root, '打开文档')).toThrow()
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
