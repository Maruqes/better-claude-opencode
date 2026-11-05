import type { MessageRow, PartRow, Rows } from './db'

export type AgentState = 'running' | 'finished' | 'stopped' | 'unknown'

export type AgentStatus = {
  id: string
  title: string
  model: string
  state: AgentState
  startedAt: number
  elapsedMs: number
  currentTool?: string
  recent: string
  cost: number
}

const RECENT_CHARS = 120
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
