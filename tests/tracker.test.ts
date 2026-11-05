import { expect, test } from 'claude-code/testing'
import {
  addAgent,
  adoptProvisional,
  agentsToWake,
  confirmAgent,
  extractAgentId,
  markRunning,
  reportedAgentId,
  resultText,
  wakeText,
} from '../hooks/tracker'
import type { AgentState } from '../types'

const RESULT = (id: string) =>
  `Done.\n\n---\nagent_id: ${id} (continue it with send_message)\nstatus: completed · m · 3 turns · 1.0s · $0.0010 · tokens in 1 / out 2`

test('reads the agent_id line of a result', () => {
  expect(extractAgentId(RESULT('ses_abc123'))).toBe('ses_abc123')
})

test('the last agent_id line wins over one quoted in the report', () => {
  expect(extractAgentId(`${RESULT('ses_quoted')}\n${RESULT('ses_real')}`)).toBe('ses_real')
})

test('reads the background and still-running forms', () => {
  expect(extractAgentId('Started agent ses_a1 in the background ("x", m). Use wait to collect the result.')).toBe('ses_a1')
  expect(extractAgentId('Resumed agent ses_a2 in the background.')).toBe('ses_a2')
  expect(extractAgentId('Agent ses_a3 is still running.\n- ses_a3 [running] "x"')).toBe('ses_a3')
})

test('ignores text without an id', () => {
  expect(extractAgentId('Error: unknown agent')).toBe(undefined)
  expect(extractAgentId('see agent_id: ses_a1 (inline)')).toBe(undefined)
})

test('addAgent does not duplicate', () => {
  expect(addAgent(addAgent([], 'ses_a'), 'ses_a')).toEqual([{ id: 'ses_a' }])
})

test('adopting skips agents already tracked', () => {
  const list = adoptProvisional([{ id: 'ses_a' }], ['ses_a', 'ses_b'], 'call1')

  expect(list).toEqual([{ id: 'ses_a' }, { id: 'ses_b', callId: 'call1' }])
})

test('confirming keeps the real agent and drops that call’s other guesses', () => {
  const list = adoptProvisional([], ['ses_a', 'ses_b'], 'call1')

  expect(confirmAgent(list, 'call1', 'ses_b')).toEqual([{ id: 'ses_b' }])
})

test('confirming adds an id that was never adopted', () => {
  const list = adoptProvisional([], ['ses_a'], 'call1')

  expect(confirmAgent(list, 'call1', 'ses_z')).toEqual([{ id: 'ses_z' }])
})

test('a call that ends without an id drops only its own guesses', () => {
  const list = adoptProvisional(adoptProvisional([{ id: 'ses_k' }], ['ses_a'], 'call1'), ['ses_b'], 'call2')

  expect(confirmAgent(list, 'call1')).toEqual([{ id: 'ses_k' }, { id: 'ses_b', callId: 'call2' }])
})

test('result text falls back from text to a string or content blocks', () => {
  expect(resultText({ result: 'ignored', text: 'core' })).toBe('core')
  expect(resultText({ result: 'plain' })).toBe('plain')
  expect(resultText({ result: [{ type: 'text', text: 'a' }, { type: 'image' }, { text: 'b' }] })).toBe('a\n\nb')
  expect(resultText({ result: { nope: 1 } })).toBeUndefined()
  expect(resultText({})).toBeUndefined()
})

const status = (id: string, state: AgentState) => ({
  id, title: `T ${id}`, model: 'm', state, startedAt: 0, elapsedMs: 0, recent: '', cost: 0,
})

test('only a final report counts as received', () => {
  expect(reportedAgentId(RESULT('ses_a'))).toBe('ses_a')
  expect(reportedAgentId('Started agent ses_a in the background ("x", m). Use wait to collect the result.')).toBe(undefined)
  expect(reportedAgentId('Resumed agent ses_a in the background.')).toBe(undefined)
  expect(reportedAgentId('Agent ses_a is still running.\n- ses_a [running] "x"')).toBe(undefined)
})

test('wakes on a move from active to finished', () => {
  const next = [status('ses_a', 'finished')]

  expect(agentsToWake([status('ses_a', 'running')], next, [], [])).toEqual(['ses_a'])
  expect(agentsToWake([status('ses_a', 'unknown')], next, [], [])).toEqual(['ses_a'])
  expect(agentsToWake([], next, [], [])).toEqual(['ses_a'])
})

test('does not wake twice, for a delivered agent, or during a call', () => {
  const previous = [status('ses_a', 'running')]
  const next = [status('ses_a', 'finished')]

  expect(agentsToWake(next, next, [], [])).toEqual([])
  expect(agentsToWake(previous, next, ['ses_a'], [])).toEqual([])
  expect(agentsToWake(previous, next, [], ['ses_a'])).toEqual([])
})

test('a stopped or still running agent gets no wake', () => {
  const previous = [status('ses_a', 'running'), status('ses_b', 'running')]

  expect(agentsToWake(previous, [status('ses_a', 'stopped'), status('ses_b', 'running')], [], [])).toEqual([])
})

test('one text names every finishing agent', () => {
  const list = [status('ses_a', 'finished'), status('ses_b', 'finished'), status('ses_c', 'running')]

  expect(wakeText(['ses_a', 'ses_b'], list)).toBe(
    'opencode agent ses_a (T ses_a) finished. Collect its result with the MCP wait tool and continue.\n' +
      'opencode agent ses_b (T ses_b) finished. Collect its result with the MCP wait tool and continue.',
  )
})

test('markRunning makes the next finish count', () => {
  const list = markRunning([status('ses_a', 'finished')], 'ses_a')

  expect(agentsToWake(list, [status('ses_a', 'finished')], [], [])).toEqual(['ses_a'])
})
