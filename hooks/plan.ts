import type { AgentStatus, Effort, Persona, Plan, PlanTask } from '../types'
import { DEFAULT_CONFIG, EFFORTS } from './config'
import type { EffortConfig, EffortEntry } from './config'

export type PlanRow = { task: PlanTask; agents: AgentStatus[]; newest?: AgentStatus }
export type PlanStats = {
  cost: number
  tokens: number
  elapsedMs: number
  done: number
  total: number
  isSettled: boolean
}

export type NormalizedPlan = { ok: true; plan: Plan } | { ok: false; error: string }

export const PERSONAS: Persona[] = ['scout', 'builder', 'tester', 'reviewer', 'general']

const ALIASES: Record<string, Effort> = {
  light: 'low',
  heavy: 'high',
  careful: 'xhigh',
}

const MESSAGES: Record<Effort, string> = {
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
}

const effortRank = (value: string) => EFFORTS.indexOf(value as Effort)
const isEffort = (value: unknown): value is Effort =>
  typeof value === 'string' && (EFFORTS as string[]).includes(value)
const isPersona = (value: unknown): value is Persona =>
  typeof value === 'string' && (PERSONAS as string[]).includes(value)
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()
const cap = (text: string, length: number) => (text.length > length ? `${text.slice(0, length - 1)}…` : text)

// An explicit effort may use a legacy alias; anything else is absent.
export const normalizeEffort = (value: unknown): Effort | undefined => {
  if (typeof value !== 'string') return undefined
  const text = value.trim().toLowerCase()
  if (isEffort(text)) return text

  return ALIASES[text]
}

const has = (text: string, pattern: RegExp) => pattern.test(text)

export const inferEffort = (title = '', prompt = ''): Effort => {
  const text = `${title} ${prompt}`.toLowerCase()
  if (has(text, /\b(typo|one[- ]line|whitespace|trivial|tiny)\b/)) return 'minimal'
  if (has(text, /\b(security|architecture|redesign|overhaul|migration|migrate|critical|whole codebase|deep)\b/)) {
    return 'max'
  }
  if (has(text, /\b(review|audit|debug|diagnose|investigate|analysis|analyse|analyze|design|root cause)\b/)) {
    return 'xhigh'
  }
  if (has(text, /\b(implement|build|refactor|integrate|feature|fix|test|write|add|update|upgrade|wire)\b/)) {
    return 'high'
  }
  if (has(text, /\b(document|docs|readme|summary|summarize|explain|rename|move|tidy|small)\b/)) return 'medium'
  if (has(text, /\b(read|list|find|locate|search|grep|survey|map|explore|research|scout)\b/)) return 'low'

  return 'medium'
}

export const inferPersona = (title = '', prompt = ''): Persona => {
  const text = `${title} ${prompt}`.toLowerCase()
  if (has(text, /\b(review|audit|critique|verify|inspect|check)\b/)) return 'reviewer'
  if (has(text, /\b(test|tests|testing|pytest|spec|qa|coverage|validate)\b/)) return 'tester'
  if (has(text, /\b(explore|investigate|research|find|locate|search|read|map|survey|analyze|analyse|scout)\b/)) {
    return 'scout'
  }
  if (has(text, /\b(implement|build|add|create|write|refactor|fix|update|migrate|wire|code|edit)\b/)) return 'builder'

  return 'general'
}

// Nearest supported variant by effort rank. An equal distance picks the stronger
// one; a model with no map passes the request through unchanged.
export const resolveVariant = (
  requested: string,
  model: string,
  variants: Record<string, string[]> = DEFAULT_CONFIG.effort.variants,
): string => {
  const name = model.includes('/') ? model.slice(model.lastIndexOf('/') + 1) : model
  const supported = variants[name]
  if (!supported?.length) return requested
  const wanted = effortRank(requested)
  if (wanted < 0) return requested

  let best = supported[0]!
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of supported) {
    const rank = effortRank(candidate)
    if (rank < 0) continue
    const distance = Math.abs(rank - wanted)
    if (distance < bestDistance || (distance === bestDistance && rank > effortRank(best))) {
      best = candidate
      bestDistance = distance
    }
  }

  return best
}

export const effortOfVariant = (variant: string | undefined): Effort | undefined => normalizeEffort(variant)

// What one plan task asks for, with its model resolved from the tier table.
export const resolvedTask = (
  task: PlanTask,
  effort: EffortConfig = DEFAULT_CONFIG.effort,
): { effort: Effort; model: string; variant: string; requested: string } => {
  const row = effort.table[task.effort]
  const model = task.model || row.model
  const requested = row.variant

  return { effort: task.effort, model, variant: resolveVariant(requested, model, effort.variants), requested }
}

export const effortForAgent = (
  plan: Plan | null,
  title: string,
  prompt: string,
  explicit: unknown,
): Effort => {
  const chosen = normalizeEffort(explicit)
  if (chosen) return chosen
  const task = plan && linkTask(plan, title)
  if (task) return task.effort

  return inferEffort(title, prompt)
}

export const normalizedTitle = (text: string) => oneLine(text).toLowerCase()

// `2. Core verdict engine` links by number; a plain title links by exact text.
export const taskIdOf = (title: string): number | undefined => {
  const found = title.match(/^\s*(\d+)[.)]\s+/)
  if (!found?.[1]) return undefined
  const id = Number(found[1])

  return Number.isInteger(id) && id > 0 ? id : undefined
}

export const linkTask = (plan: Plan, title: string): PlanTask | undefined => {
  const id = taskIdOf(title)
  if (id !== undefined) return plan.tasks.find(t => t.id === id)
  const wanted = normalizedTitle(title)

  return plan.tasks.find(t => normalizedTitle(t.title) === wanted)
}

export const planRows = (plan: Plan, statuses: AgentStatus[]): PlanRow[] =>
  plan.tasks.map(task => {
    const agents = statuses.filter(agent => {
      const id = taskIdOf(agent.title)
      if (id !== undefined) return id === task.id

      return normalizedTitle(agent.title) === normalizedTitle(task.title)
    })
    const newest = [...agents].sort((a, b) => b.startedAt - a.startedAt)[0]

    return { task, agents, ...(newest && { newest }) }
  })

export const unplannedAgents = (plan: Plan, statuses: AgentStatus[]): AgentStatus[] =>
  statuses.filter(agent => !linkTask(plan, agent.title))

const isSettledState = (agent: AgentStatus) => agent.state === 'finished' || agent.state === 'stopped'

// Cost, tokens and wall-clock time across the plan's agents. An agent counts when
// it links to a task or started at/after the plan; parallel work is not summed.
export const planStats = (plan: Plan, statuses: AgentStatus[], now: number): PlanStats => {
  const rows = planRows(plan, statuses)
  const linked = new Set(rows.flatMap(row => row.agents.map(a => a.id)))
  const scoped = statuses.filter(a => linked.has(a.id) || a.startedAt >= plan.createdAt)
  const cost = scoped.reduce((sum, a) => sum + (Number.isFinite(a.cost) ? a.cost : 0), 0)
  const tokens = scoped.reduce((sum, a) => sum + (Number.isFinite(a.tokens) ? a.tokens : 0), 0)
  const settled = scoped.length > 0 && scoped.every(isSettledState)
  const end = settled ? Math.max(...scoped.map(a => a.startedAt + a.elapsedMs)) : now
  const elapsedMs = scoped.length ? Math.max(0, end - plan.createdAt) : 0
  const done = rows.filter(row => row.agents.length > 0 && row.agents.every(isSettledState)).length

  return { cost, tokens, elapsedMs, done, total: plan.tasks.length, isSettled: settled }
}

export const formatTokens = (tokens: number) => {
  if (!Number.isFinite(tokens) || tokens <= 0) return '0'
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1).replace(/\.0$/, '')}k`

  return String(Math.round(tokens))
}

export const formatCost = (cost: number) => {
  if (!Number.isFinite(cost) || cost <= 0) return '≈$0.00'
  if (cost < 0.01) return `≈$${cost.toFixed(4)}`

  return `≈$${cost.toFixed(2)}`
}

export const formatClock = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60

  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}` : `${minutes}:${String(rest).padStart(2, '0')}`
}

const parseId = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return undefined

  return value
}

const parseAfter = (value: unknown): number[] | undefined => {
  if (value === undefined) return []
  if (!Array.isArray(value)) return undefined
  const ids = value.map(parseId)
  if (ids.some(id => id === undefined)) return undefined

  return [...new Set(ids as number[])].sort((a, b) => a - b)
}

const parseTasks = (value: unknown): NormalizedPlan => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) {
    return { ok: false, error: 'tasks must hold between 1 and 50 items' }
  }

  const rows: Array<{ raw: Record<string, unknown>; id?: number; after: number[] }> = []
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) return { ok: false, error: `task ${index + 1} must be an object` }
    const title = typeof item.title === 'string' ? oneLine(item.title) : ''
    if (!title) return { ok: false, error: `task ${index + 1} needs a title` }
    const id = item.id === undefined ? undefined : parseId(item.id)
    if (item.id !== undefined && id === undefined) {
      return { ok: false, error: `task ${index + 1} has an invalid id; use a positive integer` }
    }
    const after = parseAfter(item.after)
    if (after === undefined) return { ok: false, error: `task ${index + 1} has an invalid after list` }
    rows.push({ raw: { ...item, title: cap(title, 120) }, ...(id && { id }), after })
  }

  const used = new Set(rows.flatMap(row => (row.id === undefined ? [] : [row.id])))
  if (used.size !== rows.filter(row => row.id !== undefined).length) {
    return { ok: false, error: 'task ids must be unique' }
  }
  let next = 1
  for (const row of rows) {
    if (row.id !== undefined) continue
    while (used.has(next)) next += 1
    row.id = next
    used.add(next)
  }

  const ids = new Set(rows.map(row => row.id!))
  for (const [index, row] of rows.entries()) {
    const unknown = row.after.find(id => !ids.has(id))
    if (unknown !== undefined) {
      return { ok: false, error: `task ${index + 1} depends on unknown task ${unknown}` }
    }
    if (row.after.includes(row.id!)) return { ok: false, error: `task ${index + 1} cannot depend on itself` }
  }

  const tasks: PlanTask[] = rows.map(row => {
    const title = row.raw.title as string
    const persona = isPersona(row.raw.persona) ? row.raw.persona : inferPersona(title)
    const effort = normalizeEffort(row.raw.effort) ?? inferEffort(title)
    const model = typeof row.raw.model === 'string' && row.raw.model.trim() ? row.raw.model.trim() : undefined

    return {
      id: row.id!,
      title,
      persona,
      effort,
      after: row.after,
      ...(model && { model }),
    }
  })

  return { ok: true, plan: { title: '', createdAt: 0, tasks } }
}

export const normalizePlan = (input: unknown, now: number): NormalizedPlan => {
  if (!isRecord(input)) return { ok: false, error: 'a plan needs a title and tasks' }
  const parsed = parseTasks(input.tasks)
  if (!parsed.ok) return parsed
  const title = typeof input.title === 'string' ? oneLine(input.title) : ''
  const plan = parsed.plan
  plan.title = cap(title || 'Untitled plan', 80)
  plan.createdAt = now

  return { ok: true, plan }
}

export const descriptionOf = (task: PlanTask) => `${task.id}. ${task.title}`

// The tool result: every resolved task, and the exact description to pass on.
export const formatPlanSet = (plan: Plan, effort: EffortConfig = DEFAULT_CONFIG.effort): string => {
  const lines = [`Plan: ${plan.title}`, `${plan.tasks.length} task${plan.tasks.length === 1 ? '' : 's'}`]
  for (const task of plan.tasks) {
    const resolved = resolvedTask(task, effort)
    const after = task.after.length ? ` · after ${task.after.join(', ')}` : ''
    lines.push(
      `${descriptionOf(task)}`,
      `  ${task.persona} · ${resolved.effort} · ${resolved.model} · ${resolved.variant}${after}`,
      `  description: "${descriptionOf(task)}"`,
    )
  }
  lines.push('Start each agent with the MCP agent tool using that exact description. Start a task only after the tasks in its after list are finished.')

  return lines.join('\n')
}

// Keeps a small helper available to pane code that only has an effort name.
export const effortLabel = (effort: Effort) => MESSAGES[effort]

// One entry of the tier table, for callers that need the raw row.
export const effortEntry = (effort: Effort, table: Record<Effort, EffortEntry>) => table[effort]
