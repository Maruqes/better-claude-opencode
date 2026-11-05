import { expect, test } from 'claude-code/testing'
import type { MessageRow, PartRow, Rows } from '../hooks/db'
import { clipText, composePrompt, formatChat, formatProgress, formatPrompts, formatReport, groupChat, isActive, parseQuestion, progressOf, QUESTION_RULE, summarize } from '../hooks/summary'

const ID = 'ses_e547fb5b1ffesqEyfSptqG038W'
const SESSION = {
  id: ID,
  title: 'Sample task',
  model: 'opencode-go/deepseek-v4.1-flash',
  variant: null,
  cost: 0.0069,
  tokens_input: 100,
  tokens_output: 20,
  tokens_reasoning: 5,
  tokens_cache_read: 40,
  tokens_cache_write: 0,
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
  todos: [],
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
    tokens: 125,
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
  expect(summarize(ID, { sessions: [SESSION], messages: [], parts: [], todos: [] }, 5100).state).toBe('unknown')
})

test('an unknown agent stops counting as active after 60 s; a running one never does', () => {
  const unknown = summarize(ID, { sessions: [], messages: [], parts: [], todos: [] }, 0)
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
    todos: [],
  }

  expect(formatReport([ID], rows, 61_100)).toBe(`${ID}  running  1m00s  bash  Sample task\n  pytest`)
  expect(formatReport([ID], rows, 61_100, true).split('\n').slice(2)).toEqual([
    '  - bash [running] pytest',
    '  - text: Looking at it',
  ])
})

const task = (status: string, content = 'Task') => ({ content, status })

test('the bar counts settled tasks and half of the one in progress', () => {
  expect(formatProgress([task('in_progress', 'One'), task('pending'), task('pending'), task('pending')])).toBe(
    '██░░░░░░░░░░░░░░ 1/4 One',
  )
  expect(formatProgress([task('completed'), task('cancelled'), task('pending', 'Three'), task('pending')])).toBe(
    '████████░░░░░░░░ 3/4 Three',
  )
  expect(formatProgress([task('completed'), task('completed', 'Last')])).toBe('████████████████ 2/2 Last')
})

test('todos reach the status and the report; other sessions do not', () => {
  const todos = [
    { session_id: ID, content: 'One', status: 'in_progress' },
    { session_id: 'ses_other', content: 'Two', status: 'pending' },
  ]
  const withTodos = { ...rows({}), todos }

  expect(summarize(ID, withTodos, 5100).tasks).toEqual([{ content: 'One', status: 'in_progress' }])
  expect(formatReport([ID], withTodos, 5100)).toContain('1/1 One')
})

test('progressOf handles empty, all done and half credit', () => {
  expect(progressOf([])).toEqual({ done: 0, total: 0, percent: 0, label: '' })
  expect(progressOf([task('completed', 'A'), task('cancelled', 'B')])).toEqual({ done: 2, total: 2, percent: 100, label: 'B' })
  expect(progressOf([task('completed', 'A'), task('in_progress', 'B'), task('pending', 'C')])).toEqual({
    done: 1, total: 3, percent: 50, label: 'B',
  })
  expect(progressOf([task('completed', 'A'), task('pending', 'B')]).label).toBe('B')
})

test('the chat is oldest first, filtered, collapsed and marks a cut', () => {
  const row = {
    message_id: 'm',
    part_id: 'p',
    role: 'assistant',
    type: 'text',
    tool: null,
    status: null,
    title: null,
    text: null,
    output: null,
    diff: null,
    tokens: null,
    cost: null,
    time_created: null,
    time_completed: null,
    total: 9,
  }
  const tool = (extra: object) => ({ ...row, type: 'tool', tool: 'bash', status: 'completed', title: 'ls', ...extra })

  expect(
    formatChat([
      { ...row, text: 'x'.repeat(800) },
      tool({ status: 'error', title: 'boom' }),
      tool({}),
      tool({}),
      tool({ tool: 'todowrite', title: '3 todos' }),
      { ...row, type: 'reasoning', text: 'Why', part_id: 'pr' },
      { ...row, text: '  ' },
      { ...row, role: 'user', text: ' Do it ' },
    ]),
  ).toEqual([
    { kind: 'prompt', text: 'Do it', messageId: 'm' },
    { kind: 'reasoning', text: 'Why', id: 'reasoning-pr', messageId: 'm' },
    { kind: 'tool', text: 'bash', detail: 'ls', id: 'tool-p', messageId: 'm' },
    { kind: 'error', text: 'bash', detail: 'boom', id: 'tool-p', messageId: 'm' },
    { kind: 'reply', text: `${'x'.repeat(800)}…`, messageId: 'm' },
  ])
})

test('groupChat folds each tool run between messages, and counts failures', () => {
  const tool = (text: string, kind: 'tool' | 'error' = 'tool') => ({ kind, text })
  const items = groupChat([
    { kind: 'prompt', text: 'Go' },
    tool('read'),
    tool('read'),
    tool('bash', 'error'),
    { kind: 'reply', text: 'Done' },
    tool('edit'),
  ])

  expect(items.map(i => (i.kind === 'steps' ? i.label : i.text))).toEqual([
    'Go',
    '3 steps: read, bash · 1 failed',
    'Done',
    '1 step: edit',
  ])
})

test('groupChat opens each assistant message with one turn line', () => {
  const items = groupChat([
    { kind: 'prompt', text: 'Go', messageId: 'u1' },
    {
      kind: 'reasoning',
      id: 'reasoning-r',
      text: 'Why\nbecause',
      messageId: 'a1',
      tokens: 1200,
      cost: 0.004,
      timeCreated: 0,
      timeCompleted: 12_000,
    },
    { kind: 'tool', text: 'bash', detail: 'ls', id: 'tool-p', messageId: 'a1', output: 'out' },
    { kind: 'reply', text: 'Done', messageId: 'a1' },
    { kind: 'tool', text: 'edit', detail: 'x', id: 'tool-q', messageId: 'a2', tokens: 300, cost: 0.001 },
  ])

  expect(items.map(item => item.kind)).toEqual(['prompt', 'turn', 'reasoning', 'steps', 'reply', 'turn', 'steps'])
  expect(items[1]).toEqual({ kind: 'turn', id: 'turn-a1', tokens: 1200, cost: 0.004, durationMs: 12_000, index: 1 })
  expect(items[2]).toEqual({ kind: 'reasoning', id: 'reasoning-r', text: 'Why\nbecause', lines: 2 })
  expect(items[5]).toEqual({ kind: 'turn', id: 'turn-a2', tokens: 300, cost: 0.001, index: 2 })
})

test('an older message with no figures gets no turn line', () => {
  expect(groupChat([{ kind: 'reply', text: 'old', messageId: 'a1' }])).toEqual([
    { kind: 'reply', text: 'old' },
  ])
})

test('clipText counts wrapped rows and leaves short text alone', () => {
  expect(clipText('a\nb\nc', 10, 3)).toEqual({ text: 'a\nb\nc', isClipped: false })
  expect(clipText('a\nb\nc\nd', 10, 3)).toEqual({ text: 'a\nb\nc\n…', isClipped: true })
  expect(clipText('x'.repeat(50), 10, 3)).toEqual({ text: `${'x'.repeat(29)}…`, isClipped: true })
})

const row = (message_id: string, role: string, text: string, time_created: number) => ({ message_id, role, text, time_created })

test('parseQuestion reads the last marker at a line start', () => {
  expect(parseQuestion('Report\n\nQUESTION: which db?\nsqlite or pg')).toBe('which db?\nsqlite or pg')
  expect(parseQuestion('QUESTION: old\nQUESTION: new')).toBe('new')
  expect(parseQuestion('the QUESTION: is inline')).toBeUndefined()
  expect(parseQuestion('QUESTION:   ')).toBeUndefined()
})

test('composePrompt keeps the task last and survives an empty template', () => {
  expect(composePrompt('SYS\n', 'do it')).toBe(`SYS\n\n${QUESTION_RULE}\n\n# Task\ndo it`)
  expect(composePrompt('', 'do it')).toBe(`${QUESTION_RULE}\n\n# Task\ndo it`)
})

test('formatPrompts labels answers and follow-ups', () => {
  const text = formatPrompts([
    row('m1', 'user', 'first', 0),
    row('m1', 'user', 'more', 0),
    row('m2', 'assistant', 'QUESTION: why?', 1),
    row('m3', 'user', 'because', 1000),
    row('m4', 'assistant', 'done', 1001),
    row('m5', 'user', 'again', 2000),
  ])

  expect(text).toBe(
    'first\nmore\n\n## Answer (1970-01-01T00:00:01.000Z)\n\nbecause\n\n## Follow-up (1970-01-01T00:00:02.000Z)\n\nagain\n',
  )
  expect(formatPrompts([])).toBe('')
})
