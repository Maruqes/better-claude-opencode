import type { AgentState, AgentStatus } from '../types'
import type { MessageRow, PartRow, Rows } from './db'

const RECENT_CHARS = 120
const UNKNOWN_LIMIT_MS = 60_000
// opencode keeps looping after these, so the agent has not ended.
const CONTINUES = ['tool-calls', 'unknown']

// shortcut: a run killed mid-turn never writes an end, so it reads as running until
// resumed; upgrade by asking the MCP `list` tool if that shows up in practice.
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
    return { id, title: id, model: '', state: 'unknown', startedAt: now, elapsedMs: 0, recent: '', cost: 0 }
  }

  const last = rows.messages.find(m => m.session_id === id)
  const parts = rows.parts.filter(p => p.session_id === id)
  const state = stateOf(last)
  const startedAt = session.run_started ?? session.time_created
  const end = state === 'running' ? now : (last?.completed ?? session.time_updated)
  const currentTool =
    state === 'running'
      ? parts.find(p => p.status === 'running' || p.status === 'pending')?.tool ?? undefined
      : undefined

  return {
    id,
    title: session.title,
    model: session.model ?? '',
    state,
    startedAt,
    elapsedMs: Math.max(0, end - startedAt),
    ...(currentTool && { currentTool }),
    recent: recentOf(last, parts),
    cost: session.cost,
  }
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
      const parts = detail ? rows.parts.filter(p => p.session_id === id).map(p => `  - ${formatPart(p)}`) : []

      return [head.filter(Boolean).join('  '), ...(status.recent ? [`  ${status.recent}`] : []), ...parts].join('\n')
    })
    .join('\n')

export const formatCounts = (statuses: AgentStatus[]) =>
  (
    [
      ['running', 'running'],
      ['finished', 'done'],
      ['stopped', 'stopped'],
      ['unknown', 'unknown'],
    ] as const
  )
    .map(([state, label]) => [statuses.filter(s => s.state === state).length, label] as const)
    .filter(([count]) => count)
    .map(([count, label]) => `${count} ${label}`)
    .join(' · ')
