import type { AgentStatus, TrackedAgent } from '../types'
import { isActive, isSettled } from './summary'

// The last match wins: an agent's report comes first and may quote another result.
const RESULT_ID = /^agent_id: (ses_[A-Za-z0-9]+) \(/gm
// Background starts and `wait` timeouts have no agent_id line.
const BACKGROUND_ID = /^(?:(?:Started|Resumed) agent|Agent) (ses_[A-Za-z0-9]+)\b/

// Only a final report has the agent_id line, so this is the agent whose result Claude got.
export const reportedAgentId = (text: string): string | undefined =>
  [...text.matchAll(RESULT_ID)].at(-1)?.[1]

export const extractAgentId = (text: string): string | undefined =>
  reportedAgentId(text) ?? text.match(BACKGROUND_ID)?.[1]

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

// An agent with no status yet counts as active: it may finish before its first poll.
export const agentsToWake = (
  previous: AgentStatus[],
  next: AgentStatus[],
  delivered: string[],
  inFlight: string[],
): string[] =>
  next
    .filter(s => (s.state === 'finished' || s.state === 'asking') && isActive(s.id, previous))
    .map(s => s.id)
    .filter(id => !delivered.includes(id) && !inFlight.includes(id))

// Every agent question goes to the person; Claude never answers one on its own.
export const PICKER_RULE =
  'Ask the user with the AskUserQuestion option picker, for every question, even if you think you know the answer. Use the options the agent listed, with its first as the recommendation; write your own only if it listed none. Then relay their answer with the MCP send_message tool on this same agent_id.'

const openTasks = (s: AgentStatus) => (s.tasks ?? []).filter(t => !isSettled(t)).map(t => t.content)

const unfinishedText = (s: AgentStatus) =>
  `opencode agent ${s.id} (${s.title}) stopped with tasks still open: ${openTasks(s).join('; ')}. Collect its result with the MCP wait tool, then use send_message on this same agent_id to make it finish them. If it cannot, tell the user why.`

export const wakeText = (ids: string[], statuses: AgentStatus[]) =>
  statuses
    .filter(s => ids.includes(s.id))
    .map(s => {
      if (s.state === 'asking') {
        return `opencode agent ${s.id} (${s.title}) is asking:\n${s.question}\n${PICKER_RULE} It stays blocked until you do.`
      }

      return openTasks(s).length
        ? unfinishedText(s)
        : `opencode agent ${s.id} (${s.title}) finished. Collect its result with the MCP wait tool and continue.`
    })
    .join('\n')

// shortcut: repeats on each user message until the agent moves on or is stopped; add a
// dismiss if abandoned agents make it noisy. Agents with a call in flight are already moving.
export const pendingText = (statuses: AgentStatus[], inFlight: string[]) =>
  statuses
    .filter(s => !inFlight.includes(s.id))
    .flatMap(s => {
      if (s.state === 'asking') {
        return `opencode agent ${s.id} (${s.title}) is blocked on this question:\n${s.question}\nIf this message answers it, relay the answer now with the MCP send_message tool on this same agent_id, and keep the agent going until its tasks are done. If not: ${PICKER_RULE} A reply in chat alone never reaches it.`
      }

      return s.state === 'finished' && openTasks(s).length ? unfinishedText(s) : []
    })
    .join('\n')

// A call left this agent running, so a finish seen while the call was in flight, or
// one too quick for a poll to see it run, still counts as a move to finished.
export const markRunning = (statuses: AgentStatus[], id: string): AgentStatus[] =>
  statuses.map(s => (s.id === id ? { ...s, state: 'running' } : s))
