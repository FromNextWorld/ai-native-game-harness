export type SkillScalar = string | number | boolean | null
export type SkillValue = SkillScalar | SkillValue[] | { [key: string]: SkillValue }

export interface SkillCallStep {
  op: 'call'
  atom: string
  args?: Record<string, SkillValue>
  saveAs?: string
}

export interface SkillProgramV1 {
  language: 'xiaotangyuan-skill-v1'
  steps: SkillCallStep[]
}

export type SkillBinaryOperator = '==' | '!=' | '>' | '>=' | '<' | '<=' | '&&' | '||'

export type SkillExpression =
  | { kind: 'literal', value: SkillValue }
  | { kind: 'reference', path: string[] }
  | { kind: 'array', items: SkillExpression[] }
  | { kind: 'object', entries: Record<string, SkillExpression> }
  | { kind: 'unary', operator: '!', operand: SkillExpression }
  | { kind: 'binary', operator: SkillBinaryOperator, left: SkillExpression, right: SkillExpression }
  | { kind: 'exists', operand: SkillExpression }

export interface SkillSourceCallStatement {
  kind: 'call'
  atom: string
  args: Record<string, SkillExpression>
  saveAs?: string
}

export interface SkillSourceIfStatement {
  kind: 'if'
  condition: SkillExpression
  then: SkillSourceStatement[]
  else?: SkillSourceStatement[]
}

export interface SkillSourceRepeatStatement {
  kind: 'repeat'
  count: number
  body: SkillSourceStatement[]
}

export interface SkillSourceTryStatement {
  kind: 'try'
  body: SkillSourceStatement[]
  fallback: SkillSourceStatement[]
}

export type SkillSourceStatement =
  | SkillSourceCallStatement
  | { kind: 'skill', skillId: string, version: number, args: Record<string, SkillExpression>, saveAs?: string }
  | { kind: 'return', value: SkillExpression }
  | SkillSourceIfStatement
  | SkillSourceRepeatStatement
  | SkillSourceTryStatement
  | { kind: 'assert', condition: SkillExpression, message: string }
  | { kind: 'fail', message: string }
  | { kind: 'break' }

export interface SkillProgramV2 {
  language: 'xiaotangyuan-skill-v2'
  source: string
  body: SkillSourceStatement[]
}

export type SkillProgram = SkillProgramV1 | SkillProgramV2

/** Frozen by the task owner, never supplied by generated skill source. */
export interface SkillAcceptance {
  version: 1
  steps: Array<{
    atom: string
    arguments?: Record<string, SkillValue>
    equals?: Record<string, SkillValue>
    positive?: string[]
    nonEmpty?: string[]
    bindings?: Record<string, { step: number, field: string }>
    resultBindings?: Record<string, { step: number, field: string }>
    allowedItems?: Record<string, SkillValue[]>
  }>
}

export interface SkillRecord {
  id: string
  gameId: string
  name: string
  description: string
  triggers: string[]
  version: number
  status: 'active' | 'archived'
  program: SkillProgram
  verified?: boolean
  acceptance?: SkillAcceptance
  createdAt: string
  updatedAt: string
  lastUsedAt?: string
  successCount: number
  failureCount: number
  lastError?: string
}

export interface SkillStepTrace {
  index: number
  atom: string
  arguments: Record<string, SkillValue>
  success: boolean
  result?: unknown
  error?: string
  callPath?: string[]
}

/** Observed pipeline stage, not an inference from a model message or empty trace. */
export type SkillFailureStage = 'compile' | 'preflight' | 'execution' | 'verification' | 'cancelled'

export interface SkillRunResult {
  success: boolean
  skillId: string
  skillVersion: number
  trace: SkillStepTrace[]
  error?: string
  value?: SkillValue
  failureStage?: SkillFailureStage
}

export interface SkillLearningAttempt {
  gameId: string
  skillId: string
  proposedVersion: number
  program: SkillProgram
  success: boolean
  trace: SkillStepTrace[]
  error?: string
  failureStage?: SkillFailureStage
  createdAt: string
}

export type GameAtomExecutor = (
  atom: string,
  args: Record<string, SkillValue>,
  signal: AbortSignal,
) => Promise<unknown>
