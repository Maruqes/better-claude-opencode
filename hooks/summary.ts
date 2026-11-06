import type { AgentState, AgentStatus, Task } from '../types'
import { HISTORY_CHARS } from './db'
import type { HistoryRow, MessageRow, PartRow, PromptRow, Rows } from './db'
import { formatTokens } from './plan'

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

// Added here, not left to Claude's brief: an agent with no todos has no progress bar and no Tasks list.
export const PROGRESS_RULE = `# Progress
Before any other work, call todowrite with your tasks: the numbered tasks in the task section, or 2 to 6 short ones of your own if it lists none. Keep exactly one in_progress, and mark each completed as soon as it is done. The person's progress bar reads these todos.`

// The system part, the rules, then Claude's task, which stays last.
export const composePrompt = (template: string, task: string) =>
  [template.trim(), QUESTION_RULE, PROGRESS_RULE, `# Task\n${task}`].filter(Boolean).join('\n\n')

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
  const percent = tasks.length ? Math.round((100 * done) / tasks.length) : 0
  const label = (active ?? tasks.find(t => !isSettled(t)) ?? tasks.at(-1))?.content ?? ''

  return { done, total: tasks.length, percent, label }
}

// `█████░░░░░░░░░░░ 2/3 Fix parser`: the bar counts settled tasks, the number is the current step.
export const formatProgress = (tasks: Task[]) => {
  const { done, total, percent, label } = progressOf(tasks)
  const filled = Math.round((BAR_WIDTH * percent) / 100)
  const step = Math.min(done + 1, total)

  return `${'█'.repeat(filled)}${'░'.repeat(BAR_WIDTH - filled)} ${step}/${total} ${label}`
}

export const taskGlyph = (task: Task) => TASK_GLYPHS[task.status] ?? '○'

export const formatTask = (task: Task) => `${taskGlyph(task)} ${task.content}`

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

export const STATE_LABELS: Record<AgentState, string> = {
  running: 'Running',
  asking: 'Needs an answer',
  finished: 'Finished',
  stopped: 'Stopped',
  unknown: 'Unknown',
}

export const thinkingLabel = (text: string, isOpen: boolean) => {
  const lines = text.split('\n')
  // Trailing blank lines are not rendered, so they must not inflate the count.
  while (lines.length && !lines.at(-1)?.trim()) lines.pop()
  const count = lines.length

  return `${isOpen ? '▾' : '▸'} Thinking · ${count} ${count === 1 ? 'line' : 'lines'}`
}

export const closingLine = (agent: AgentStatus): string | undefined => {
  if (agent.state === 'running') return agent.currentTool ? `Working · ${agent.currentTool}` : 'Working'
  if (agent.state === 'asking' || agent.state === 'unknown') return undefined

  const elapsed = formatElapsed(agent.elapsedMs)
  const head = agent.state === 'finished' ? `Finished in ${elapsed}` : `Stopped after ${elapsed}`
  // A zero figure is dropped so a short or free run shows only what it has.
  const figures = [
    agent.tokens > 0 ? `${formatTokens(agent.tokens)} tok` : '',
    agent.cost > 0 ? formatTurnCost(agent.cost) : '',
  ].filter(Boolean)

  return [head, ...figures].join(' · ')
}

export const questionParts = (question: string) => {
  const lines = question.trim().split('\n')
  const options: string[] = []
  // The question rule puts its options last, so only a trailing run is a list.
  while (lines.length && lines.at(-1)?.startsWith('- ')) options.unshift(lines.pop()!.slice(2).trim())

  return { text: lines.join('\n').trim(), options }
}

// The task text of a composed prompt; a prompt without the rules (send_message, old agents) is returned as is.
export const promptTask = (text: string) => {
  const rule = text.indexOf(QUESTION_RULE)
  const marker = rule < 0 ? -1 : text.indexOf('# Task\n', rule + QUESTION_RULE.length)

  return marker < 0 ? text : text.slice(marker + '# Task\n'.length)
}

// `Code` takes tab and newline as its only control characters; tool output carries colour codes and `\r`.
export const codeText = (text: string) =>
  text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/
const IS_BODY = /^[ +\-\\]/

// Whole, well-formed hunks for the engine's diff view: headers before the first `@@` go, at most `maxLines`
// body lines stay, a cut-off last line goes, and each header's counts follow the lines kept.
export const clipDiff = (diff: string, maxLines: number) => {
  const lines = diff.split('\n')
  const first = lines.findIndex(line => line.startsWith('@@'))
  if (first < 0) return lines.slice(0, maxLines).join('\n')
  const hunks: { head: RegExpMatchArray; body: string[] }[] = []
  let kept = 0
  for (const line of lines.slice(first)) {
    const head = line.match(HUNK)
    if (head) hunks.push({ head, body: [] })
    else if (!hunks.length) return diff
    else if (kept < maxLines) {
      hunks.at(-1)!.body.push(line)
      kept += 1
    } else break
  }
  const last = hunks.at(-1)
  while (last?.body.length && !IS_BODY.test(last.body.at(-1)!)) last.body.pop()

  return hunks
    .filter(h => h.body.length)
    .map(({ head, body }) => {
      const old = body.filter(l => !l.startsWith('+') && !l.startsWith('\\')).length
      const next = body.filter(l => !l.startsWith('-') && !l.startsWith('\\')).length

      return [`@@ -${head[1]},${old} +${head[2]},${next} @@${head[3]}`, ...body].join('\n')
    })
    .join('\n')
}
