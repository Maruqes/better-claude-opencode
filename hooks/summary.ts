import type { AgentState, AgentStatus, Task } from '../types'
import { HISTORY_CHARS } from './db'
import type { HistoryRow, MessageRow, PartRow, PromptRow, Rows } from './db'

const RECENT_CHARS = 120
const UNKNOWN_LIMIT_MS = 60_000
const BAR_WIDTH = 16
const TASK_GLYPHS: Record<string, string> = { completed: '✓', in_progress: '●', cancelled: '✕' }
// opencode keeps looping after these, so the agent has not ended.
const CONTINUES = ['tool-calls', 'unknown']

// shortcut: a run killed mid-turn never writes an end, so it reads as running until
// resumed; upgrade by asking the MCP `list` tool if that shows up in practice.
export const QUESTION_RULE = `# Questions
If you are in doubt and cannot go on safely, stop and end your final message with a paragraph that starts with "QUESTION:" at the start of a line, followed by your question, then 2 to 4 short answer options as lines starting with "- ", your recommended one first. Nothing may come after them. Claude's answer arrives as your next message. Never use that marker for anything else.`

// The system part, the rule, then Claude's task, which stays last.
export const composePrompt = (template: string, task: string) =>
  [template.trim(), QUESTION_RULE, `# Task\n${task}`].filter(Boolean).join('\n\n')

// The last marker wins: a report may quote an earlier one.
export const parseQuestion = (text: string): string | undefined => {
  const marker = [...text.matchAll(/^QUESTION:/gm)].at(-1)
  if (marker?.index === undefined) return undefined

  return text.slice(marker.index + marker[0].length).trim() || undefined
}

// What opencode received: the first prompt, then each later message as a dated section.
export const formatPrompts = (rows: PromptRow[]) => {
  let text = ''
  let reply = ''
  let messageId: string | undefined
  for (const row of rows) {
    if (row.role !== 'user') reply = row.text
    else if (row.message_id === messageId) text += `\n${row.text}`
    else {
      const heading = parseQuestion(reply) ? 'Answer' : 'Follow-up'
      text += text ? `\n\n## ${heading} (${new Date(row.time_created).toISOString()})\n\n${row.text}` : row.text
      messageId = row.message_id
    }
  }

  return text && `${text}\n`
}

const stateOf = (last: MessageRow | undefined): AgentState => {
  if (!last) return 'unknown'
  if (last.error_name === 'MessageAbortedError') return 'stopped'
  if (last.error_name) return 'finished'
  if (last.role !== 'assistant' || !last.completed) return 'running'

  return CONTINUES.includes(last.finish ?? '') ? 'running' : 'finished'
}

const excerpt = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, RECENT_CHARS)

const recentOf = (last: MessageRow | undefined, parts: PartRow[]) => {
  if (last?.error_name && last.error_name !== 'MessageAbortedError') {
    return excerpt(last.error_message ?? last.error_name)
  }
  const part = parts.find(p => (p.type === 'text' ? p.text?.trim() : p.title ?? p.tool))

  return excerpt((part?.type === 'text' ? part.text : part?.title ?? part?.tool) ?? '')
}

export const summarize = (id: string, rows: Rows, now: number): AgentStatus => {
  const session = rows.sessions.find(s => s.id === id)
  if (!session) {
    return {
      id,
      title: id,
      model: '',
      state: 'unknown',
      startedAt: now,
      elapsedMs: 0,
      recent: '',
      cost: 0,
      tokens: 0,
    }
  }

  const last = rows.messages.find(m => m.session_id === id)
  const parts = rows.parts.filter(p => p.session_id === id)
  const tasks = rows.todos.filter(t => t.session_id === id).map(({ content, status }) => ({ content, status }))
  const ended = stateOf(last)
  const question = ended === 'finished' && !last?.error_name ? parseQuestion(last?.last_text ?? '') : undefined
  const state = question ? 'asking' : ended
  const startedAt = session.run_started ?? session.time_created
  const end = state === 'running' ? now : (last?.completed ?? session.time_updated)
  const currentTool =
    state === 'running'
      ? parts.find(p => p.status === 'running' || p.status === 'pending')?.tool ?? undefined
      : undefined
  const tokens =
    (session.tokens_input ?? 0) + (session.tokens_output ?? 0) + (session.tokens_reasoning ?? 0)

  return {
    id,
    title: session.title,
    model: session.model ?? '',
    ...(session.variant && session.variant !== 'default' && { variant: session.variant }),
    state,
    startedAt,
    elapsedMs: Math.max(0, end - startedAt),
    ...(currentTool && { currentTool }),
    recent: recentOf(last, parts),
    cost: session.cost,
    tokens,
    ...(tasks.length && { tasks }),
    ...(question && { question }),
  }
}

export const isSettled = (task: Task) => task.status === 'completed' || task.status === 'cancelled'

export const progressOf = (tasks: Task[]) => {
  const done = tasks.filter(isSettled).length
  const active = tasks.find(t => t.status === 'in_progress')
  const percent = tasks.length ? Math.round((100 * (done + (active ? 0.5 : 0))) / tasks.length) : 0
  const label = (active ?? tasks.find(t => !isSettled(t)) ?? tasks.at(-1))?.content ?? ''

  return { done, total: tasks.length, percent, label }
}

// `████░░░░░░░░░░░░ 1/3 Fix parser`: the task in progress counts as half done.
export const formatProgress = (tasks: Task[]) => {
  const { done, total, percent, label } = progressOf(tasks)
  const filled = Math.round((BAR_WIDTH * percent) / 100)
  const step = Math.min(done + 1, total)

  return `${'█'.repeat(filled)}${'░'.repeat(BAR_WIDTH - filled)} ${step}/${total} ${label}`
}

export const formatTask = (task: Task) => `${TASK_GLYPHS[task.status] ?? '○'} ${task.content}`

export type ChatEntry = {
  kind: 'prompt' | 'reply' | 'tool' | 'error' | 'reasoning'
  text: string
  detail?: string
  id?: string
  messageId?: string
  output?: string
  diff?: string
  tokens?: number
  cost?: number
  timeCreated?: number
  timeCompleted?: number
}

const HIDDEN_TOOLS = ['todowrite', 'todoread']

const toEntry = (row: HistoryRow): ChatEntry | undefined => {
  const shared = {
    ...(row.message_id && { messageId: row.message_id }),
    ...(row.tokens !== null && row.tokens !== undefined && { tokens: row.tokens }),
    ...(row.cost !== null && row.cost !== undefined && { cost: row.cost }),
    ...(row.time_created !== null && row.time_created !== undefined && { timeCreated: row.time_created }),
    ...(row.time_completed !== null && row.time_completed !== undefined && { timeCompleted: row.time_completed }),
  }
  if (row.type === 'tool') {
    if (!row.tool || HIDDEN_TOOLS.includes(row.tool)) return undefined
    const output = row.output?.trim()
    const diff = row.diff?.trim()

    return {
      kind: row.status === 'error' ? 'error' : 'tool',
      text: row.tool,
      ...(row.title && { detail: row.title }),
      ...(row.part_id && { id: `tool-${row.part_id}` }),
      ...(output && { output }),
      ...(diff && { diff }),
      ...shared,
    }
  }
  if (row.type === 'reasoning') {
    const text = row.text?.trim() ?? ''
    if (!text) return undefined

    return {
      kind: 'reasoning',
      text,
      ...(row.part_id && { id: `reasoning-${row.part_id}` }),
      ...shared,
    }
  }
  const text = row.text?.trim() ?? ''
  if (row.type !== 'text' || !text) return undefined

  return row.role === 'user'
    ? { kind: 'prompt', text, ...shared }
    : { kind: 'reply', text: text.length >= HISTORY_CHARS ? `${text}…` : text, ...shared }
}

// Rows arrive newest first; the chat reads oldest first.
export const formatChat = (rows: HistoryRow[]): ChatEntry[] =>
  rows
    .map(toEntry)
    .reverse()
    .filter((e): e is ChatEntry => !!e)
    .filter((e, i, all) => {
      const prev = all[i - 1]
      return !(
        prev &&
        (e.kind === 'tool' || e.kind === 'error') &&
        prev.kind === e.kind &&
        prev.text === e.text &&
        prev.detail === e.detail
      )
    })

export type ChatItem =
  | { kind: 'prompt'; text: string }
  | { kind: 'reply'; text: string }
  | { kind: 'steps'; id: string; label: string; steps: ChatEntry[] }
  | { kind: 'reasoning'; id: string; text: string }
  | { kind: 'turn'; id: string; tokens: number; cost: number; durationMs?: number; index: number }

const stepsLabel = (steps: ChatEntry[]) => {
  const names = [...new Set(steps.map(s => s.text))].join(', ')
  const failed = steps.filter(s => s.kind === 'error').length

  return `${steps.length} step${steps.length === 1 ? '' : 's'}: ${names}${failed ? ` · ${failed} failed` : ''}`
}

const durationOf = (entry: ChatEntry) =>
  entry.timeCreated !== undefined && entry.timeCompleted !== undefined
    ? Math.max(0, entry.timeCompleted - entry.timeCreated)
    : undefined

// Each run of tool calls between messages is one item. The id is its first step, so
// it stays expanded as the run grows and as the history window moves. A dim turn
// line opens each assistant message that carries cost, tokens or a duration.
export const groupChat = (entries: ChatEntry[]): ChatItem[] => {
  const items: ChatItem[] = []
  let run: ChatEntry[] = []
  let message: string | undefined
  let index = 0
  const flush = () => {
    if (run[0]) items.push({ kind: 'steps', id: `${run[0].text} ${run[0].detail ?? ''}`, label: stepsLabel(run), steps: run })
    run = []
  }
  const openTurn = (entry: ChatEntry) => {
    if (!entry.messageId || entry.messageId === message) return
    flush()
    message = entry.messageId
    index += 1
    const tokens = entry.tokens ?? 0
    const cost = entry.cost ?? 0
    const durationMs = durationOf(entry)
    if (tokens > 0 || cost > 0 || durationMs !== undefined) {
      items.push({ kind: 'turn', id: `turn-${entry.messageId}`, tokens, cost, ...(durationMs !== undefined && { durationMs }), index })
    }
  }

  for (const entry of entries) {
    if (entry.kind === 'prompt') {
      flush()
      message = undefined
      items.push({ kind: 'prompt', text: entry.text })
      continue
    }
    openTurn(entry)
    if (entry.kind === 'reasoning') {
      flush()
      items.push({
        kind: 'reasoning',
        id: entry.id ?? `reasoning-${items.length}`,
        text: entry.text,
      })
    } else if (entry.kind === 'reply') {
      flush()
      items.push({ kind: 'reply', text: entry.text })
    } else run.push(entry)
  }
  flush()

  return items
}

export const formatShortElapsed = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`

  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`
}

export const formatTurnCost = (cost: number) => {
  if (!Number.isFinite(cost) || cost <= 0) return ''
  if (cost < 0.01) return `$${cost.toFixed(3)}`

  return `$${cost.toFixed(2)}`
}

// Cuts `text` to what fills `maxRows` rows of `columns` cells, counting wrapped lines.
export const clipText = (text: string, columns: number, maxRows: number) => {
  const width = Math.max(1, columns)
  let rows = 0
  let end = 0
  for (const line of text.split('\n')) {
    const room = maxRows - rows
    const lineRows = Math.max(1, Math.ceil(line.length / width))
    if (lineRows > room) return { text: `${text.slice(0, end + Math.max(0, room * width - 1))}…`, isClipped: true }
    rows += lineRows
    end += line.length + 1
  }

  return { text, isClipped: false }
}

// The first `maxRows` visual rows of `text`, wrapped at `columns` cells; blank lines stay as empty rows.
export const wrapRows = (text: string, columns: number, maxRows: number) => {
  const width = Math.max(1, columns)
  const rows: string[] = []
  for (const line of text.split('\n')) {
    if (!line) rows.push('')
    for (let at = 0; at < line.length; at += width) rows.push(line.slice(at, at + width))
    if (rows.length >= maxRows) break
  }

  return rows.slice(0, maxRows)
}

export const isActive = (id: string, statuses: AgentStatus[], trackedForMs = 0) => {
  const state = statuses.find(s => s.id === id)?.state
  if (state === 'unknown') return trackedForMs <= UNKNOWN_LIMIT_MS

  return !state || state === 'running'
}

export const formatElapsed = (ms: number) => {
  const seconds = Math.floor(ms / 1000)

  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`
}

const formatPart = (part: PartRow) =>
  part.type === 'text'
    ? `text: ${excerpt(part.text ?? '')}`
    : [part.tool, part.status && `[${part.status}]`, excerpt(part.title ?? '')].filter(Boolean).join(' ')

// One block per agent; `rows.parts` is already the newest parts of each session.
export const formatReport = (ids: string[], rows: Rows, now: number, detail = false) =>
  ids
    .map(id => {
      const status = summarize(id, rows, now)
      const head = [id, status.state, formatElapsed(status.elapsedMs), status.currentTool, status.title]
      const progress = status.tasks ? [`  ${formatProgress(status.tasks)}`] : []
      const parts = detail ? rows.parts.filter(p => p.session_id === id).map(p => `  - ${formatPart(p)}`) : []

      return [head.filter(Boolean).join('  '), ...progress, ...(status.recent ? [`  ${status.recent}`] : []), ...parts].join('\n')
    })
    .join('\n')

export const formatCounts = (statuses: AgentStatus[]) =>
  (
    [
      ['running', 'running'],
      ['asking', 'asking'],
      ['finished', 'done'],
      ['stopped', 'stopped'],
      ['unknown', 'unknown'],
    ] as const
  )
    .map(([state, label]) => [statuses.filter(s => s.state === state).length, label] as const)
    .filter(([count]) => count)
    .map(([count, label]) => `${count} ${label}`)
    .join(' · ')
