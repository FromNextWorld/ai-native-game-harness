import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { captureWorkFiles, hasPowerShellResearch } from '../src/work-evidence.js'
import { requiresArtifactWrite, requiresWebResearch, verifyWorkExecution, workVerificationInstruction } from '../src/work-orchestrator-service.js'

const receipt = (command: string) => [
  { seq: 0, time: Date.now(), type: 'tool/call', data: { callId: 'audit', name: 'pwsh', arguments: JSON.stringify({ command }) } },
  { seq: 1, time: Date.now(), type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: 'audit', isError: false }] } } },
] as never

describe('office follow-up evidence regression', () => {
  it.each([
    '# Invoke-WebRequest https://example.invalid',
    "Write-Output \"Invoke-WebRequest 'https://example.invalid'\"",
    "<# Invoke-RestMethod 'https://example.invalid' #>",
    "if ($false) { Invoke-WebRequest 'https://example.invalid' }",
    "@'\nInvoke-WebRequest 'https://example.invalid'\n'@",
    "curl --version 'https://example.invalid'",
    "$client = New-Object System.Net.WebClient; $client = $null; $client.DownloadString('https://example.invalid')",
    "Write-Output 'System.Net.Http.HttpClient'",
  ])('does not accept inert research: %s', command => {
    expect(hasPowerShellResearch(command)).toBe(false)
    expect(() => verifyWorkExecution(receipt(command), 0, tmpdir(), '联网查资料')).toThrow('web research')
  })
  it.each([
    "Invoke-WebRequest -Uri 'https://example.invalid' | Select-Object -ExpandProperty Content",
    "$page = Invoke-RestMethod -Uri 'https://example.invalid'",
    "curl 'https://example.invalid'",
    "$client = New-Object System.Net.WebClient; $result = $client.DownloadString('https://example.invalid')",
  ])('accepts a successful direct request receipt: %s', command => {
    expect(verifyWorkExecution(receipt(command), 0, tmpdir(), '联网查资料').researched).toBe(true)
  })
  it('opens an existing final HTML without rewriting it or researching again', () => {
    const root = mkdtempSync(join(tmpdir(), 'work-followup-'))
    try {
      const file = join(root, 'final.html')
      writeFileSync(file, '<!doctype html><html><body>Final</body></html>')
      const before = captureWorkFiles(root)
      const instruction = workVerificationInstruction('打开最终成果', '联网查资料并生成 HTML')
      expect(requiresArtifactWrite(instruction)).toBe(false)
      expect(requiresWebResearch(instruction)).toBe(false)
      expect(verifyWorkExecution(receipt(`Start-Process -FilePath '${file}'`), 0, root, instruction, before))
        .toMatchObject({ opened: true, artifactPaths: [], researched: false })
      writeFileSync(join(root, 'other.txt'), 'Not the HTML artifact')
      expect(() => verifyWorkExecution(receipt(`Start-Process '${join(root, 'other.txt')}'`), 0, root, instruction, before)).toThrow('open')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it.each(['第二部分改短一点', '做吧', '重新生成并打开'])('still verifies requested changes: %s', instruction => {
    expect(requiresArtifactWrite(workVerificationInstruction(instruction, 'AI 游戏 HTML'))).toBe(true)
  })
  it('does not inherit stale actions or format when the user specifies a new format', () => {
    expect(workVerificationInstruction('生成 Markdown，不要联网，也不要打开', '联网生成 HTML 并打开'))
      .toBe('生成 Markdown，不要联网，也不要打开')
  })
})
