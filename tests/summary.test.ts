import { expect, test } from 'claude-code/testing'
import type { MessageRow, PartRow, Rows } from '../hooks/db'
import { formatReport, isActive, summarize } from '../hooks/summary'

const ID = 'ses_e547fb5b1ffesqEyfSptqG038W'
const SESSION = {
  id: ID,
  title: 'Sample task',
  model: 'opencode-go/deepseek-v4.1-flash',
  cost: 0.0069,
  time_created: 1000,
  time_updated: 9000,
  run_started: 1100,
}
const MESSAGE: MessageRow = {
  session_id: ID,
  role: 'assistant',
  finish: null,
  completed: null,
  error_name: null,
  error_message: null,
}
const TOOL: PartRow = {
  session_id: ID,
  type: 'tool',
  tool: 'bash',
  status: 'completed',
  title: 'sleep 20',
  text: null,
}
const rows = (message: Partial<MessageRow>, parts: PartRow[] = []): Rows => ({
  sessions: [SESSION],
  messages: [{ ...MESSAGE, ...message }],
  parts,
})

test('an open assistant message is running, with its current tool', () => {
  const status = summarize(ID, rows({}, [{ ...TOOL, status: 'running' }]), 5100)

  expect(status).toEqual({
    id: ID,
    title: 'Sample task',
    model: 'opencode-go/deepseek-v4.1-flash',
    state: 'running',
    startedAt: 1100,
    elapsedMs: 4000,
    currentTool: 'bash',
    recent: 'sleep 20',
    cost: 0.0069,
  })
})

test('a user message waiting for its reply is running', () => {
  expect(summarize(ID, rows({ role: 'user' }), 5100).state).toBe('running')
})

test('a completed step that called tools is still running', () => {
  expect(summarize(ID, rows({ finish: 'tool-calls', completed: 3000 }), 5100).state).toBe('running')
})

test('finish stop is finished, timed to its completion, with no current tool', () => {
  const text = { ...TOOL, type: 'text', tool: null, status: null, title: null, text: ' Final\n report ' }
  const status = summarize(ID, rows({ finish: 'stop', completed: 3100 }, [text, TOOL]), 5100)

  expect(status.state).toBe('finished')
  expect(status.elapsedMs).toBe(2000)
  expect(status.currentTool).toBe(undefined)
  expect(status.recent).toBe('Final report')
})

test('an aborted message is stopped', () => {
  const aborted = { completed: 3100, error_name: 'MessageAbortedError', error_message: 'Aborted' }

  expect(summarize(ID, rows(aborted, [TOOL]), 5100).state).toBe('stopped')
  expect(summarize(ID, rows(aborted, [TOOL]), 5100).recent).toBe('sleep 20')
})

test('a provider error ends the agent and shows the error', () => {
  const failed = { completed: 3100, error_name: 'APIError', error_message: 'key expired' }
  const status = summarize(ID, rows(failed), 5100)

  expect(status.state).toBe('finished')
  expect(status.recent).toBe('key expired')
})

test('no session or no message is unknown', () => {
  expect(summarize('ses_missing', rows({}), 5100).state).toBe('unknown')
  expect(summarize(ID, { sessions: [SESSION], messages: [], parts: [] }, 5100).state).toBe('unknown')
})

test('an unknown agent stops counting as active after 60 s; a running one never does', () => {
  const unknown = summarize(ID, { sessions: [], messages: [], parts: [] }, 0)
  const running = { ...unknown, state: 'running' as const }

  expect(isActive(ID, [unknown], 60_000)).toBe(true)
  expect(isActive(ID, [unknown], 60_001)).toBe(false)
  expect(isActive(ID, [running], 600_000)).toBe(true)
})

test('the report is compact, and detail adds one line per part', () => {
  const part = (extra: Partial<PartRow>): PartRow => ({
    session_id: ID, type: 'tool', tool: null, status: null, title: null, text: null, ...extra,
  })
  const rows: Rows = {
    sessions: [SESSION],
    messages: [MESSAGE],
    parts: [
      part({ tool: 'bash', status: 'running', title: 'pytest' }),
      part({ type: 'text', text: 'Looking\n  at it' }),
    ],
  }

  expect(formatReport([ID], rows, 61_100)).toBe(`${ID}  running  1m00s  bash  Sample task\n  pytest`)
  expect(formatReport([ID], rows, 61_100, true).split('\n').slice(2)).toEqual([
    '  - bash [running] pytest',
    '  - text: Looking at it',
  ])
})
