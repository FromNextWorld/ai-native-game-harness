import { existsSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

/** Conservative evidence parser, not a PowerShell interpreter.
 * Complex control flow requires a separate simple verification command.
 */
export function evidenceStatements(command: string): string[] {
  const statements: string[] = []
  let text = '', quote = '', lineComment = false, blockComment = false
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!, next = command[i + 1]
    if (blockComment) { if (c === '#' && next === '>') { blockComment = false; i++ } continue }
    if (lineComment) { if (c !== '\n') continue; lineComment = false }
    if (quote) {
      text += c
      if (c === '`' && quote === '"' && next) { text += next; i++; continue }
      if (c === quote) {
        if (next === quote) { text += next; i++ } else quote = ''
      }
      continue
    }
    if (c === '<' && next === '#') { blockComment = true; text += ' '; i++; continue }
    if (c === '#') { lineComment = true; continue }
    if (c === '@' && (next === '"' || next === "'")) return []
    if (c === '{' || c === '}' || c === '`' || c === '&' || (c === '$' && next === '(')) return []
    if (c === '"' || c === "'") { quote = c; text += c; continue }
    if (c === ';' || c === '\n' || c === '\r') {
      if (text.trim()) statements.push(text.trim())
      text = ''
    } else text += c
  }
  if (quote || blockComment) return []
  if (text.trim()) statements.push(text.trim())
  return statements
}

export function hasPowerShellResearch(command: string): boolean {
  const clients = new Set<string>()
  for (const statement of evidenceStatements(command)) {
    const assignment = statement.match(/^\$([a-z_]\w*)\s*=\s*(.*)$/i)
    const body = assignment?.[2] ?? statement
    const download = body.match(/^\$([a-z_]\w*)\.Download(?:String|Data|File)\(\s*(['"])https?:\/\/[^'"\s]+\2(?:\s*,\s*(['"])[^'"]+\3)?\s*\)\s*$/i)
    if (download && clients.has(download[1]!.toLowerCase())) return true
    if (assignment) {
      const name = assignment[1]!.toLowerCase()
      clients.delete(name)
      if (/^New-Object\s+(?:-TypeName\s+)?System\.Net\.WebClient\s*$/i.test(body)) clients.add(name)
    }
    if (/^(?:Invoke-WebRequest|Invoke-RestMethod)\s+/i.test(body)
      && !/-WhatIf\b/i.test(body) && /(['"])https?:\/\/[^'"\s]+\1/i.test(body)) return true
    // curl/wget accept many local-only modes; accept a plain URL request only.
    if (/^(?:curl|wget)(?:\.exe)?\s+(['"])https?:\/\/[^'"\s]+\1\s*$/i.test(body)) return true
  }
  return false
}

export type WorkFileSnapshot = ReadonlyMap<string, string>
export function evidencePathKey(path: string): string {
  const absolute = resolve(path)
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}
export function fileStamp(path: string): string {
  const s = statSync(path)
  return `${s.size}:${s.mtimeMs}:${s.ctimeMs}`
}
export function captureWorkFiles(root: string): WorkFileSnapshot {
  const result = new Map<string, string>()
  let visited = 0
  const visit = (directory: string): void => {
    if (!existsSync(directory)) return
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (++visited > 50_000) throw new Error('工作目录文件过多，无法可靠验收；请为办公任务选择独立的成果目录。')
      if (entry.isSymbolicLink()) continue
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) result.set(evidencePathKey(path), fileStamp(path))
    }
  }
  visit(resolve(root))
  return result
}
