// Prepare only. Never writes to the installed plugin or starts/stops the app.
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import ts from 'typescript'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const installed = resolve(process.argv[2] ?? '')
if (!installed.endsWith('dsh-xiaotangyuan-game/dist') && !installed.endsWith('dsh-xiaotangyuan-game\\dist')) throw new Error('Explicit installed plugin dist path required')
const root = mkdtempSync(join(tmpdir(), 'xty-diagnostics-stage-'))
const files = ['runtime/diagnostics', 'runtime/error-diagnostics', 'runtime/agent/game-agent-session', 'runtime/speech/speech-controller', 'runtime/media/windows-media-host', 'gateway/game-gateway']
const hashes = {}
const hash = data => createHash('sha256').update(data).digest('hex')
const emit = (source, fileName) => ts.transpileModule(source, {
  fileName, compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext, verbatimModuleSyntax: true },
}).outputText.replace(/^\/\/# sourceMappingURL=.*$/gm, '')
for (const file of files) {
  const source = `plugins/xiaotangyuan-game/src/${file}.ts`
  const baseline = spawnSync('git', ['show', `HEAD:${source}`], { cwd: repo, encoding: 'utf8' })
  for (const side of ['before', 'after', 'stage']) mkdirSync(dirname(join(root, side, `${file}.js`)), { recursive: true })
  if (baseline.status === 0) writeFileSync(join(root, 'before', `${file}.js`), emit(baseline.stdout, `${file}.mts`))
  writeFileSync(join(root, 'after', `${file}.js`), emit(readFileSync(join(repo, source), 'utf8'), `${file}.mts`))
  const current = join(installed, `${file}.js`)
  hashes[`${file}.js`] = existsSync(current) ? hash(readFileSync(current)) : null
  if (existsSync(current)) copyFileSync(current, join(root, 'stage', `${file}.js`))
}
const diff = spawnSync('git', ['diff', '--no-index', '--', 'before', 'after'], { cwd: root, encoding: 'utf8' })
if (diff.status !== 1) throw new Error(`Expected diagnostic changes: ${diff.stderr}`)
writeFileSync(join(root, 'diagnostics.patch'), diff.stdout)
const check = spawnSync('git', ['apply', '--check', '--ignore-space-change', '-p2', '-'], { cwd: join(root, 'stage'), input: diff.stdout, encoding: 'utf8' })
writeFileSync(join(root, 'manifest.json'), JSON.stringify({ installed, hashes, check: check.status, checkOutput: check.stderr }, null, 2))
if (check.status === 0) {
  execFileSync('git', ['apply', '--ignore-space-change', '-p2', '-'], { cwd: join(root, 'stage'), input: diff.stdout })
} else {
  // Only the three inspected deployed extensions are supported. Never discard
  // unmatched hunks or substitute a full main-branch build for installed skills.
  spawnSync('git', ['apply', '--reject', '--ignore-space-change', '-p2', '-'], { cwd: join(root, 'stage'), input: diff.stdout, encoding: 'utf8' })
  const extensions = {
    'gateway/game-gateway': {
      marker: "stage: 'gateway.session.warmup'",
      before: '        void state.session.warmup(saveId).catch(error => {',
      addition: "\n            reportRuntimeError(error, { stage: 'gateway.session.warmup', gameId: state.adapter?.gameId, processId: state.adapter?.processId });",
    },
    'runtime/agent/game-agent-session': {
      marker: "stage: 'agent.model.reply'",
      before: '            const partialReply = latestAssistantText(handle.agent.session.events, firstSeq) || accumulator.currentText();',
      addition: "\n            reportRuntimeError(error, { stage: 'agent.model.reply', sessionId, interactionId, source, gameId: this.adapter?.gameId, provider: this.selection?.provider, model: this.selection?.model, recovered: partialReply !== '' });",
    },
    'runtime/speech/speech-controller': {
      marker: "import { reportRuntimeError }",
      before: "import { publishProductDiagnostic } from '../diagnostics.js';",
      addition: "\nimport { reportRuntimeError } from '../error-diagnostics.js';",
    },
  }
  for (const file of files) {
    const rejected = join(root, 'stage', `${file}.js.rej`)
    if (!existsSync(rejected)) continue
    const rule = extensions[file]
    const rejection = readFileSync(rejected, 'utf8')
    if (!rule || rejection.split(/^@@/m).length !== 2 || !rejection.includes(rule.marker)) throw new Error(`Unrecognized rejected hunk: ${rejected}`)
    const path = join(root, 'stage', `${file}.js`)
    let text = readFileSync(path, 'utf8').replaceAll('\r\n', '\n')
    if (text.includes(rule.marker) || text.split(rule.before).length !== 2) throw new Error(`Ambiguous deployed extension: ${file}`)
    text = text.replace(rule.before, rule.before + rule.addition)
    writeFileSync(path, text)
  }
}
  for (const file of files) {
    const path = join(root, 'stage', `${file}.js`)
    // The installed map describes an older file; keep it backed up but do not reference it.
    writeFileSync(path, readFileSync(path, 'utf8').replace(/^\/\/# sourceMappingURL=.*$/gm, ''))
    execFileSync(process.execPath, ['--check', path])
  }
  // Known deployed learning fallback precedes partial-reply recovery.
  const agentPath = join(root, 'stage', 'runtime/agent/game-agent-session.js')
  const agent = readFileSync(agentPath, 'utf8')
  const learningCatch = '            if (learningRequest || this.learningBudget.outcome(sessionId) !== undefined) {\n                this.ctx.logger.warn(error);'
  if (agent.includes(learningCatch)) {
    if (agent.split(learningCatch).length !== 2) throw new Error('Ambiguous learning fallback')
    writeFileSync(agentPath, agent.replace(learningCatch, learningCatch + "\n                reportRuntimeError(error, { stage: 'agent.model.learning-fallback', sessionId, interactionId, source, gameId: this.adapter?.gameId });"))
    execFileSync(process.execPath, ['--check', agentPath])
  }
  const stagedHashes = Object.fromEntries(files.map(file => [`${file}.js`, hash(readFileSync(join(root, 'stage', `${file}.js`)))]))
  writeFileSync(join(root, 'manifest.json'), JSON.stringify({ installed, hashes, stagedHashes, prepared: true, compatibilityExtensions: check.status !== 0 }, null, 2))
  console.log(JSON.stringify({ root, prepared: true, files: files.length, installedModified: false }))
