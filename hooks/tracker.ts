import type { TrackedAgent } from '../types'

// The last match wins: an agent's report comes first and may quote another result.
const RESULT_ID = /^agent_id: (ses_[A-Za-z0-9]+) \(/gm
// Background starts and `wait` timeouts have no agent_id line.
const BACKGROUND_ID = /^(?:(?:Started|Resumed) agent|Agent) (ses_[A-Za-z0-9]+)\b/

export const extractAgentId = (text: string): string | undefined =>
  [...text.matchAll(RESULT_ID)].at(-1)?.[1] ?? text.match(BACKGROUND_ID)?.[1]

// Core sets `text` on what it ran, but another hook's own answer carries only `result`.
export const resultText = (ran: { result?: unknown; text?: string }): string | undefined => {
  if (ran.text !== undefined) return ran.text
  if (typeof ran.result === 'string') return ran.result
  if (!Array.isArray(ran.result)) return undefined

  return ran.result.map((block: { text?: unknown }) => (typeof block?.text === 'string' ? block.text : '')).join('\n')
}

export const addAgent = (list: TrackedAgent[], id: string): TrackedAgent[] =>
  list.some(a => a.id === id)
    ? list.map(a => (a.id === id ? { id } : a))
    : [...list, { id }]

export const adoptProvisional = (
  list: TrackedAgent[],
  ids: string[],
  callId: string,
): TrackedAgent[] => [
  ...list,
  ...ids.filter(id => !list.some(a => a.id === id)).map(id => ({ id, callId })),
]

// Ends a call: its id, if any, is confirmed and its other guesses go. A guess that
// belongs to another call still in flight is adopted again on the next poll.
export const confirmAgent = (
  list: TrackedAgent[],
  callId: string,
  id?: string,
): TrackedAgent[] => {
  const kept = list.filter(a => a.callId !== callId || a.id === id)

  return id ? addAgent(kept, id) : kept
}
