import { expect, test } from 'claude-code/testing'

import { endsAtBottom } from '../hooks/register'

const PANE = {
  plugin: 'opencode-agent-monitor',
  component: 'Pane',
  requestId: 'opencode-agents',
  props: {
    title: 'opencode agents',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('the pane shows its header and empty line, on every surface', async $ => {
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect((await ui.find({ type: 'Text', text: /^opencode/ }))?.text).toBe('opencode agents')
    expect((await ui.find({ type: 'Text', text: /No agents/ }))?.text).toBe('No agents yet')
    await ui.unmount()
  }
})

const TOOL = 'mcp__plugin_opencode-subagent-mcp_opencode__'
const agent = (id: string, state: string, extra = {}) => ({
  id, title: `Task ${id}`, model: 'deepseek-flash', state, startedAt: 0, elapsedMs: 72000, recent: 'running pytest', cost: 0, ...extra,
})
const seed = (on: any, statuses: object[], warning?: string, stopError?: string, extra: Record<string, unknown> = {}) =>
  on('state.get', (_: unknown, e: { key: string }) => {
    if (e.key in extra) return { value: { value: extra[e.key], version: 1 } }
    if (e.key === 'tracked') return { value: { value: { shape: 'tracked-1', value: statuses.map((s: any) => ({ id: s.id })) }, version: 1 } }
    if (e.key === 'statuses') return { value: { value: { shape: 'statuses-1', value: statuses }, version: 1 } }
    return { value: { value: e.key === 'stopError' ? stopError : warning, version: 1 } }
  })

test('the pane draws each state and the warning', async ($, on) => {
  seed(on, [
    agent('ses_r', 'running', { currentTool: 'bash' }),
    agent('ses_f', 'finished'),
    agent('ses_s', 'stopped'),
    agent('ses_u', 'unknown'),
  ], 'Activity unavailable: boom')

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const text = async (t: RegExp) => (await ui.find({ type: 'Text', text: t }))?.text

    expect(await text(/running ·/)).toBe('1 running · 1 done · 1 stopped · 1 unknown')
    expect(await text(/^●/)).toBe('●')
    expect(await text(/^✓/)).toBe('✓')
    expect(await text(/^■/)).toBe('■')
    expect(await text(/^\?/)).toBe('?')
    expect(await text(/^Task ses_r/)).toBe('Task ses_r')
    expect(await text(/^· deepseek-flash/)).toBe('· deepseek-flash · 1m12s · bash')
    expect((await ui.findAll({ type: 'Text', text: /pytest/ })).length).toBe(0)
    expect(await text(/^!/)).toBe('! Activity unavailable: boom')
    expect(await ui.find({ key: 'stop-ses_r' })).toBeDefined()
    expect(await ui.find({ key: 'stop-ses_f' })).toBeUndefined()
    await ui.unmount()
  }
})

test('Stop calls the MCP and tells Claude; a failure warns', async ($, hook) => {
  const on = hook as any
  const stops: unknown[] = []
  const notes: any[] = []
  let isError = false
  seed(on, [agent('ses_r', 'running')])
  on('mcp.call', (_: unknown, e: unknown) => {
    stops.push(e)
    return { value: { content: [{ type: 'text', text: 'nope' }], isError } }
  })
  on('session.append', (_: unknown, e: unknown, next: (e: unknown) => unknown) => {
    notes.push(e)
    return next(e)
  })
  const writes: any[] = []
  on('state.set', (_: unknown, e: unknown) => {
    writes.push(e)
    return { value: { isSet: true, version: 2 } }
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'stop-ses_r' })
  expect(JSON.stringify(stops[0])).toContain('ses_r')
  expect(JSON.stringify(stops[0])).toContain('plugin:opencode-subagent-mcp:opencode')
  expect(JSON.stringify(notes[0])).toContain('user stopped opencode agent ses_r')

  isError = true
  await ui.press({ key: 'stop-ses_r' })
  expect(notes.length).toBe(1)
  const failed = writes.find(w => JSON.stringify(w).includes('Stop failed: nope'))
  expect(failed.key).toBe('stopError')

  isError = false
  await ui.press({ key: 'stop-ses_r' })
  expect(writes.at(-1).key).toBe('stopError')
  expect(writes.at(-1).value).toBe('')
  await ui.unmount()
})

test('a Stop failure has its own row beside the activity warning', async ($, on) => {
  seed(on, [agent('ses_r', 'running')], 'Activity unavailable: boom', 'Stop failed: nope')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect((await ui.findAll({ type: 'Text', text: /^!/ })).map(t => t.text)).toEqual([
    '! Activity unavailable: boom',
    '! Stop failed: nope',
  ])
  await ui.unmount()
})

const engine = (on: any, every: () => unknown = () => new Promise(() => {})) => {
  const opened: unknown[] = []
  const writes: unknown[] = []
  const state = new Map<string, any>()
  on('state.get', (_: unknown, e: { key: string }) => ({
    value: state.has(e.key) ? { value: state.get(e.key), version: 1 } : { version: 0 },
  }))
  on('state.set', (_: unknown, e: { key: string; value: unknown }) => {
    state.set(e.key, e.value)
    return { value: { isSet: true, version: 1 } }
  })
  on('command.register', () => ({ value: { command: 'opencode-agents' } }))
  on('tool.register', () => ({ value: {} }))
  on('ui.open', (_: unknown, e: unknown) => (opened.push(e), { value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/p' }))
  on('fs.write', (_: unknown, e: unknown) => (writes.push(e), { value: undefined }))
  on('clock.now', () => ({ value: 1000 }))
  on('clock.every', every)

  return { opened, writes, tracked: () => state.get('tracked')?.value }
}
test('a tool call tracks its id, opens the pane and keeps the result', async ($, on) => {
  const { opened, tracked } = engine(on)
  const answer = { result: {}, text: 'done\nagent_id: ses_new (resume with send_message)' }
  on('tool.call', () => answer)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ran = await $.tool.call({ tool: `${TOOL}agent`, prompt: 'x' })

  expect(ran.text).toBe(answer.text)
  expect(tracked()).toEqual([{ id: 'ses_new' }])
  expect(opened.length).toBe(1)
})

test('send_message tracks its id before the call ends, and a failed call still fails', async ($, on) => {
  const { tracked } = engine(on)
  let during: unknown
  on('tool.call', () => {
    during = tracked()
    throw new Error('boom')
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  let thrown = ''
  try {
    await $.tool.call({ tool: `${TOOL}send_message`, agent_id: 'ses_old', prompt: 'x' })
  } catch (e) {
    thrown = String(e)
  }

  expect(during).toEqual([{ id: 'ses_old' }])
  // The harness reports a throwing test hook as its own error; it still reaches the caller.
  expect(thrown).not.toBe('')
})

const STATUS = 'mcp__opencode-agent-monitor__opencode_status'
const running = (on: any, argv: (a: string[]) => { exitCode: number; stdout: string; stderr: string }) =>
  on('process.run', (_: unknown, e: { argv: string[] }) => ({ value: argv(e.argv) }))

test('the status tool answers an empty list and an untracked id', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  expect((await $.tool.call({ tool: STATUS })).result).toBe('No opencode agents tracked.')
  expect((await $.tool.call({ tool: STATUS, agent_id: 'ses_x' })).result).toBe(
    'Agent ses_x is not tracked in this session.',
  )
})

test('the status tool reports a database failure as text', async ($, on) => {
  engine(on)
  running(on, () => ({ exitCode: 1, stdout: '', stderr: 'no database' }))
  on('tool.call', () => ({ result: {}, text: 'agent_id: ses_a (x)' }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: `${TOOL}agent`, prompt: 'x' })

  const { result } = await $.tool.call({ tool: STATUS })
  expect(result).toBe('Activity unavailable: no database. The MCP wait tool still works.')
})

test('the status tool queries fresh rows', async ($, on) => {
  engine(on)
  const session = { id: 'ses_a', title: 'Task', model: 'm', cost: 0, time_created: 0, time_updated: 0, run_started: 0 }
  running(on, argv => {
    const sql = argv.at(-1) ?? ''
    const stdout = argv[0] === 'opencode' ? '/db' : sql.includes('from session') ? JSON.stringify([session]) : ''
    return { exitCode: 0, stdout, stderr: '' }
  })
  on('tool.call', () => ({ result: {}, text: 'agent_id: ses_a (x)' }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: `${TOOL}agent`, prompt: 'x' })

  expect((await $.tool.call({ tool: STATUS, agent_id: 'ses_a' })).result).toBe('ses_a  unknown  0m00s  Task')
})

// A poll per release of the clock; `row` is the agent's newest message.
const polling = (on: any) => {
  const ticks: (() => void)[] = []
  const base = engine(on, () => new Promise<{ value: undefined }>(r => ticks.push(() => r({ value: undefined }))))
  const prompts: string[] = []
  const live = { refuses: false, query: (_sql: string): unknown[] | undefined => undefined, row: { session_id: 'ses_a', role: 'assistant', completed: null as number | null, finish: 'stop' } }
  on('session.cwd', () => ({ value: '/' }))
  on('prompt.submit', (_: unknown, e: { text: string }) => {
    if (live.refuses) throw new Error('refused')
    prompts.push(e.text)
    return { text: e.text }
  })
  running(on, argv => {
    const sql = argv.at(-1) ?? ''
    const session = { id: 'ses_a', title: 'Task', model: 'm', cost: 0, time_created: 0, time_updated: 0, run_started: 0 }
    const rows = live.query(sql) ?? (sql.includes('from session where id') ? [session] : sql.includes('from message where') ? [live.row] : [])
    return { exitCode: 0, stdout: argv[0] === 'opencode' ? '/db' : JSON.stringify(rows), stderr: '' }
  })
  // The contract types have no timers, but the test runner does.
  const settle = () => new Promise(r => (globalThis as any).setTimeout(r, 10))
  const tick = async () => {
    await settle()
    ticks.shift()?.()
    await settle()
  }

  return { ...base, prompts, live, tick }
}

test('a background agent wakes Claude exactly once when it finishes', async ($, on) => {
  const { prompts, live, tick } = polling(on)
  const answer = { result: {}, text: 'Started agent ses_a in the background ("x", m). Use wait to collect the result.' }
  ;(on as any)('tool.call', () => answer)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: `${TOOL}agent`, prompt: 'x' })

  await tick()
  expect(prompts).toEqual([])
  live.row.completed = 5
  await tick()
  await tick()
  expect(prompts).toEqual([
    'opencode agent ses_a (Task) finished. Collect its result with the MCP wait tool and continue.',
  ])
})

test('a result Claude received gets no wake, until send_message runs it again', async ($, on) => {
  const { prompts, live, tick } = polling(on)
  const report = 'Done\n\n---\nagent_id: ses_a (continue it with send_message)\nstatus: completed'
  let text = 'Started agent ses_a in the background ("x", m). Use wait to collect the result.'
  ;(on as any)('tool.call', () => ({ result: {}, text }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: `${TOOL}agent`, prompt: 'x' })
  await tick()

  text = report
  await $.tool.call({ tool: `${TOOL}wait`, agent_id: 'ses_a' })
  live.row.completed = 5
  await tick()
  await tick()
  expect(prompts).toEqual([])

  text = 'Resumed agent ses_a in the background.'
  await $.tool.call({ tool: `${TOOL}send_message`, agent_id: 'ses_a', message: 'more' })
  await tick()
  await tick()
  expect(prompts.length).toBe(1)
})

test('a wait timeout is not a delivery, even when the finish came during the call', async ($, on) => {
  const { prompts, live, tick } = polling(on)
  let release = () => {}
  ;(on as any)('tool.call', () =>
    new Promise(r => {
      release = () => r({ result: {}, text: 'Agent ses_a is still running.\n- ses_a [running] "x"' })
    }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const call = $.tool.call({ tool: `${TOOL}wait`, agent_id: 'ses_a' })
  await tick()
  live.row.completed = 5
  await tick()
  expect(prompts).toEqual([])

  release()
  await call
  await tick()
  expect(prompts.length).toBe(1)
})

test('a failed wake warns and polling goes on', async ($, on) => {
  const { prompts, live, tick } = polling(on)
  live.refuses = true
  ;(on as any)('tool.call', () => ({ result: {}, text: 'Started agent ses_a in the background ("x", m).' }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: `${TOOL}agent`, prompt: 'x' })
  await tick()
  live.row.completed = 5
  await tick()
  live.refuses = false
  await tick()

  const after = await $.tool.call({ tool: STATUS })
  expect(String(after.result)).toContain('ses_a  finished')
  expect(prompts).toEqual([])
})

test('the progress bar is a filled track on every surface, with a gap between the buttons', async ($, on) => {
  const tasks = [
    { content: 'One', status: 'completed' },
    { content: 'Two', status: 'in_progress' },
  ]
  seed(on, [agent('ses_r', 'running', { tasks })])

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const bar = await ui.find({ key: 'bar-ses_r' })

    expect(JSON.stringify(bar)).toContain(surface === 'terminal' ? '"75%"' : '75% done')
    expect((await ui.find({ type: 'Text', text: /1\/2/ }))?.text).toBe('· deepseek-flash · 1m12s · 1/2')
    expect(JSON.stringify(await ui.findAll({ type: 'Text', text: /^[*█░]+$/ }))).toBe('[]')
    const open = await ui.find({ key: 'open-ses_r' })
    expect(open).toBeDefined()
    expect(JSON.stringify(await ui.find({ key: 'stop-ses_r' }))).toBeDefined()
    await ui.unmount()
  }
})

test('Open shows the task list and the chat in order; Close hides them', async ($, on) => {
  const { live, tick } = polling(on)
  const rows = [
    { role: 'assistant', type: 'text', tool: null, status: null, title: null, text: 'All **done**', total: 150 },
    { role: 'assistant', type: 'tool', tool: 'bash', status: 'completed', title: 'pytest -q', text: null, total: 150 },
    { role: 'user', type: 'text', tool: null, status: null, title: null, text: 'Fix the parser', total: 150 },
  ]
  live.row.completed = 5
  live.query = sql =>
    sql.includes('count(*) over')
      ? rows
      : sql.includes('from todo')
        ? [{ session_id: 'ses_a', content: 'Fix it', status: 'in_progress' }]
        : undefined
  ;(on as any)('tool.call', () => ({ result: {}, text: 'Started agent ses_a in the background ("x", m).' }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: `${TOOL}agent`, prompt: 'x' })
  await tick()

  // state.get is faked here, so nothing redraws a mounted pane: mount it again.
  const shown = async (t: RegExp, type = 'Text') => {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const found = await ui.findAll({ type, text: t } as any)
    await ui.unmount()

    return found.map(f => f.text)
  }
  const press = async (key: string, target: object = PANE) => {
    const ui = await $.ui.mount({ ...target, surface: 'desktop' } as any)
    await ui.press({ key })
    await tick()
    await ui.unmount()
  }

  expect(await shown(/Fix it/)).toEqual([])
  expect(await shown(/^bash/)).toEqual([])

  await press('open-ses_a')
  const order = [...(await shown(/./))].filter(t => /^(Fix the parser|bash)/.test(t ?? ''))
  expect(order[0]).toBe('Fix the parser')
  expect(await shown(/^bash/)).toEqual(['bash  pytest -q'])
  expect(await shown(/All/, 'Markdown')).toEqual(['All **done**'])
  expect(await shown(/hidden/)).toEqual(['Earlier activity hidden · showing the latest 3'])
  // The chat owns the pane: the header says what runs, the checklist waits behind its button.
  expect(await shown(/^opencode agents/)).toEqual([])
  expect(await shown(/● Fix it/)).toEqual([])
  const inBand = async (t: RegExp) => {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' } as any)
    const found = await ui.findAll({ type: 'Text', text: t } as any)
    await ui.unmount()

    return found.map(f => f.text)
  }
  expect(await inBand(/^Fix it/)).toEqual(['Fix it'])
  // The harness has no ui.scroll implementation: the call is denied, and the pane goes on without a warning.
  expect(await shown(/^!/)).toEqual([])

  await press('tasks')
  expect(await shown(/● Fix it/)).toEqual(['● Fix it'])
  await press('tasks')
  expect(await shown(/● Fix it/)).toEqual([])

  await press('back')
  expect(await shown(/^bash/)).toEqual([])
  expect(await shown(/^opencode agents/)).toEqual(['opencode agents'])
})

test('tool runs fold behind one line, a long prompt behind Show more, and the header is pinned in the pane', async ($, on) => {
  const { live, tick } = polling(on)
  const tool = (t: string) => ({ role: 'assistant', type: 'tool', tool: t, status: 'completed', title: 'x', text: null, total: 3 })
  live.query = sql =>
    sql.includes('count(*) over')
      ? [tool('edit'), tool('read'), { role: 'user', type: 'text', tool: null, status: null, title: null, text: `${'p'.repeat(500)}\n\n# Task\ndo it`, total: 3 }]
      : undefined
  ;(on as any)('tool.call', () => ({ result: {}, text: 'Started agent ses_a in the background ("x", m).' }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: `${TOOL}agent`, prompt: 'x' })
  await tick()
  const mounted = async (act: (ui: any) => Promise<unknown>) => {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, scroll: { offset: 7, bodyRows: 20 } } })
    const value = await act(ui)
    await tick()
    await ui.unmount()

    return value
  }
  await mounted(ui => ui.press({ key: 'open-ses_a' }))

  // Running, so the latest step stays visible under its folded run.
  expect(((await mounted(ui => ui.find({ key: 'steps-1' }))) as any).props.label).toMatch(/^▸ 2 steps: read, edit/)
  expect(await mounted(ui => ui.findAll({ type: 'Text', text: /^(read|edit)  x/ }))).toHaveLength(1)
  expect((await mounted(ui => ui.find({ key: 'chat-header' })))?.props.top).toBe(7)
  await mounted(ui => ui.press({ key: 'steps-1' }))
  expect(await mounted(ui => ui.findAll({ type: 'Text', text: /^(read|edit)  x/ }))).toHaveLength(2)
  expect(((await mounted(ui => ui.find({ key: 'steps-1' }))) as any).props.label).toMatch(/^▾ 2 steps/)

  // Desktop draws the clipped prompt as one fading image; the terminal keeps the stepped text rows.
  expect(JSON.stringify(await mounted(ui => ui.find({ type: 'Svg' })))).toContain('mask')
  expect(await mounted(ui => ui.find({ type: 'Text', text: /^p+/ }))).toBeUndefined()
  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, scroll: { offset: 7, bodyRows: 20 } } })
  expect(((await terminal.find({ type: 'Text', text: /^p+/ })) as any).text.length).toBe(200)
  await terminal.unmount()
  await mounted(ui => ui.press({ key: 'prompt-0' }))
  expect(((await mounted(ui => ui.find({ type: 'Text', text: /^p+/ }))) as any).text.length).toBe(514)
  expect(await mounted(ui => ui.find({ type: 'Text', text: /# Task\ndo it$/ }))).toBeDefined()
})

test('Jump to latest shows once the person scrolls up, and pressing it resumes following', async ($, on) => {
  const { live, tick } = polling(on)
  live.query = sql =>
    sql.includes('count(*) over')
      ? [{ role: 'assistant', type: 'text', tool: null, status: null, title: null, text: 'hi', total: 1 }]
      : undefined
  ;(on as any)('tool.call', () => ({ result: {}, text: 'Started agent ses_a in the background ("x", m).' }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: `${TOOL}agent`, prompt: 'x' })
  await tick()
  const open = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await open.press({ key: 'open-ses_a' })
  await tick()
  await open.unmount()
  const jump = async () => {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const found = await ui.find({ key: 'jump-latest' })
    if (found) await ui.press({ key: 'jump-latest' })
    await tick()
    await ui.unmount()

    return found
  }
  expect(await jump()).toBeUndefined()
  await ($ as any).ui.scroll({ component: 'Pane', requestId: 'opencode-agents', offset: 0, by: -5, bodyRows: 20, contentRows: 100, origin: { kind: 'person' } }).catch(() => {})
  expect(await jump()).toBeDefined()
  expect(await jump()).toBeUndefined()
})

test('a poll that changes the open chat redraws it, and a refused scroll never breaks it', async ($, on) => {
  const { live, tick } = polling(on)
  let n = 0
  live.query = sql =>
    sql.includes('count(*) over')
      ? [{ role: 'assistant', type: 'text', tool: null, status: null, title: null, text: `reply ${n}`, total: 1 }]
      : undefined
  ;(on as any)('tool.call', () => ({ result: {}, text: 'Started agent ses_a in the background ("x", m).' }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: `${TOOL}agent`, prompt: 'x' })
  await tick()
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'open-ses_a' })
  await tick()
  n = 1
  await tick()
  await ui.unmount()

  const again = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await again.find({ type: 'Markdown' } as any))?.text).toBe('reply 1')
  expect(await again.find({ type: 'Text', text: /^!/ })).toBeUndefined()
  await again.unmount()
})

test('the window counts as following within one row of the bottom', () => {
  const at = (offset: number) => endsAtBottom({ offset, contentRows: 100, bodyRows: 20 })

  expect(at(80)).toBe(true)
  expect(at(79)).toBe(true)
  expect(at(60)).toBe(false)
})

test('the system prompt gains the delegation section', async ($, on) => {
  ;(on as any)('prompt.compose', () => ({ sections: [] }))
  const { sections } = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] })

  expect(sections.at(-1)?.text).toContain('todowrite')
})

test('agent prompts get the template and rule; send_message stays as sent', async ($, on) => {
  engine(on)
  const seen: any[] = []
  ;(on as any)('fs.read', () => ({ value: 'SYSTEM' }))
  ;(on as any)('tool.call', (_: unknown, e: unknown) => (seen.push(e), { result: {}, text: 'agent_id: ses_a (x)' }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await $.tool.call({ tool: `${TOOL}agent`, prompt: 'do it' })
  await $.tool.call({ tool: `${TOOL}send_message`, agent_id: 'ses_a', message: 'more' })

  expect(seen[0].prompt.startsWith('SYSTEM\n\n# Questions')).toBe(true)
  expect(seen[0].prompt.endsWith('# Task\ndo it')).toBe(true)
  expect(seen[1].message).toBe('more')
})

test('the list hides agent output; the prompt path moves to the chat view', async ($, on) => {
  seed(on, [agent('ses_q', 'asking', { question: 'which db?' })], undefined, undefined, {
    prompts: { shape: 'prompts-1', value: ['ses_q'] },
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const text = async (t: RegExp) => (await ui.find({ type: 'Text', text: t }))?.text

  expect(await text(/asking$/)).toBe('1 asking')
  expect(await text(/^· asking ·/)).toBe('· asking · deepseek-flash · 1m12s')
  expect(await text(/which db/)).toBeUndefined()
  expect(await text(/prompt\.txt/)).toBeUndefined()
  await ui.unmount()
})

const BAND = {
  plugin: 'opencode-agent-monitor',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 40, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const
const taskPair = [{ content: 'One', status: 'completed' }, { content: 'Two', status: 'in_progress' }]

test('the band shows the open agent header with working buttons, and nothing otherwise', async ($, on) => {
  let opened = ''
  // Stands for the engine's own band beneath the plugin.
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)

    return <Text>engine band</Text>
  })
  on('state.get', (_: unknown, e: { key: string }) => {
    const v = (value: unknown) => ({ value: { value, version: 1 } })
    if (e.key === 'openAgent') return v(opened)
    if (e.key === 'tracked') return v({ shape: 'tracked-1', value: [{ id: 'ses_h' }] })
    if (e.key === 'statuses') return v({ shape: 'statuses-1', value: [agent('ses_h', 'running', { tasks: taskPair })] })
    return v(e.key === 'prompts' ? { shape: 'prompts-1', value: ['ses_h'] } : e.key === 'chatView' ? { shape: 'chat-view-2', value: { isTasksOpen: false, expanded: [] } } : '')
  })
  on('state.set', (_: unknown, e: any) => {
    if (e.key === 'openAgent') opened = e.value
    return { value: { isSet: true, version: 1 } }
  })
  for (const surface of ['terminal'] as const) {
    opened = ''
    const closed = await $.ui.mount({ ...BAND, surface })
    expect(await closed.find({ key: 'back' })).toBeUndefined()
    expect(await closed.find({ type: 'Text', text: /engine band/ })).toBeDefined()
    await closed.unmount()

    opened = 'ses_h'
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ key: 'tasks' })).toBeDefined()
    expect(await ui.find({ key: 'stop-ses_h' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Task ses_h/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Two/ })).toBeDefined()
    await ui.press({ key: 'back' })
    expect(opened).toBe('')
    await ui.unmount()
  }
})

test('every surface but the terminal pins the header in the pane', async ($, on) => {
  seed(on, [agent('ses_h', 'running', { tasks: taskPair })], undefined, undefined, { openAgent: 'ses_h' })
  for (const surface of ['vscode', 'mobile', 'terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(!!(await ui.find({ key: 'back' }))).toBe(surface !== 'terminal')
    await ui.unmount()
  }
})

test('open tasks render as full-text wrapping cards in the page, not the header', async ($, on) => {
  const long = 'Rewrite the whole parser so that every long task description stays fully readable '.repeat(3).trim()
  seed(on, [agent('ses_h', 'running', { tasks: [{ content: long, status: 'in_progress' }] })], undefined, undefined, {
    openAgent: 'ses_h',
    chatView: { shape: 'chat-view-2', value: { isTasksOpen: true, expanded: [] } },
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const t = (await ui.find({ type: 'Text', text: /Rewrite the whole parser/ })) as any
    expect(t.text).toContain(long)
    expect(t.props.wrap).toBe('wrap')
    await ui.unmount()
  }
})

test('the chat view shows the prompt path', async ($, on) => {
  seed(on, [agent('ses_q', 'asking', { question: 'which db?' })], undefined, undefined, {
    openAgent: 'ses_q',
    prompts: { shape: 'prompts-1', value: ['ses_q'] },
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /prompt\.txt/ }))?.text).toBe('.opencode-monitor/ses_q/prompt.txt')
  await ui.unmount()
})

test('a question wakes Claude once, and prompt.txt is written once the id is confirmed', async ($, on) => {
  const { prompts, writes, live, tick } = polling(on)
  ;(on as any)('tool.call', () => ({ result: {}, text: 'Started agent ses_a in the background ("x", m).' }))
  live.query = sql =>
    sql.includes('m.id as message_id') ? [{ message_id: 'm', role: 'user', text: 'the task', time_created: 0 }] : undefined
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: `${TOOL}agent`, prompt: 'x' })
  await tick()
  await tick()

  const files = JSON.stringify(writes)
  expect(files).toContain('/p/.opencode-monitor/ses_a/prompt.txt')
  expect(files).toContain('the task')
  const count = writes.length

  Object.assign(live.row, { completed: 5, last_text: 'Stuck.\nQUESTION: which db?' })
  await tick()
  await tick()
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('is asking:\nwhich db?')
  expect(writes.length).toBe(count)
})

test('a user message carries the pending question, a plugin message does not', async ($, on) => {
  const seen: any[] = []
  ;(on as any)('prompt.submit', (_: unknown, e: any) => {
    seen.push(e)
    return { text: e.text }
  })
  seed(on, [agent('ses_a', 'asking', { question: 'which db?' })])
  await $.prompt.submit({ text: 'use postgres', origin: { kind: 'sdk' } } as any)
  await $.prompt.submit({ text: 'wake', origin: { kind: 'plugin', name: 'x' } } as any)

  expect(seen[0].context[0]).toContain('which db?')
  expect(seen[1].context).toBeUndefined()
})

const PLAN = {
  title: 'Ride Verdict MVP',
  createdAt: 0,
  tasks: [
    { id: 1, title: 'Scout the current API', persona: 'scout', effort: 'low', after: [] },
    { id: 2, title: 'Core verdict engine', persona: 'builder', effort: 'high', after: [1] },
    { id: 3, title: 'Review the engine', persona: 'reviewer', effort: 'xhigh', after: [2] },
  ],
}

test('the plan view draws stats, tasks, dependencies, personas and unplanned agents', async ($, on) => {
  const statuses = [
    agent('ses_1', 'finished', {
      title: '1. Scout the current API',
      model: 'opencode-go/deepseek-v4.1-flash',
      variant: 'low',
      startedAt: 0,
      elapsedMs: 41_000,
      cost: 0.001,
      tokens: 100,
    }),
    agent('ses_2', 'running', {
      title: '2. Core verdict engine',
      model: 'opencode-go/deepseek-v4-pro',
      variant: 'high',
      startedAt: 72_000,
      elapsedMs: 72_000,
      cost: 0.002,
      tokens: 200,
      currentTool: 'bash',
    }),
    agent('ses_u', 'running', {
      title: 'Hotfix typo',
      startedAt: 80_000,
      elapsedMs: 8000,
      cost: 0.0001,
      tokens: 10,
    }),
  ]
  const writes: any[] = []
  seed(on, statuses, undefined, undefined, {
    plan: { shape: 'plan-1', value: PLAN },
    planView: { shape: 'plan-view-1', value: { isCollapsed: false } },
  })
  ;(on as any)('state.set', (_: unknown, e: unknown) => {
    writes.push(e)
    return { value: { isSet: true, version: 2 } }
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const text = async (t: RegExp) => (await ui.find({ type: 'Text', text: t }))?.text

  expect(await text(/^Ride Verdict MVP/)).toBe('Ride Verdict MVP')
  expect(await text(/^Cost/)).toBe('Cost')
  expect(await text(/^≈\$0\.0031/)).toBe('≈$0.0031')
  expect(await text(/^310$/)).toBe('310')
  expect(await text(/^2:24$/)).toBe('2:24')
  expect(await text(/^Planned/)).toBe('Planned · 3 · 1 done')
  expect(await text(/^1\. Scout/)).toBe('1. Scout the current API')
  expect(await text(/^2\. Core/)).toBe('2. Core verdict engine')
  expect(await text(/^high$/)).toBe('high')
  expect(await text(/^· opencode-go\/deepseek-v4-pro/)).toBe('· opencode-go/deepseek-v4-pro · high · bash · after 1')
  expect(await text(/^Unplanned/)).toBe('Unplanned · 1')
  expect((await ui.findAll({ type: 'Svg' })).length).toBeGreaterThan(0)
  expect(await ui.find({ key: 'open-ses_2' })).toBeDefined()
  expect(await ui.find({ key: 'open-ses_1' })).toBeDefined()
  await ui.unmount()

  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await terminal.findAll({ type: 'Text', text: /^\[B\]/ })).length).toBe(1)
  await terminal.unmount()

  const collapsed = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await collapsed.press({ key: 'plan-collapse' })
  expect(writes.find(w => w.key === 'planView')?.value.value).toEqual({ isCollapsed: true })
  await collapsed.unmount()

  const cleared = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await cleared.press({ key: 'plan-clear' })
  expect(writes.find(w => w.key === 'plan' && w.value.value === null)).toBeDefined()
  await cleared.unmount()
})

test('a dependency still running makes the early-start warning visible', async ($, on) => {
  seed(
    on,
    [
      agent('ses_1', 'running', { title: '1. Scout the current API', startedAt: 0 }),
      agent('ses_2', 'running', { title: '2. Core verdict engine', startedAt: 1000 }),
    ],
    undefined,
    undefined,
    {
      plan: { shape: 'plan-1', value: PLAN },
      planView: { shape: 'plan-view-1', value: { isCollapsed: false } },
    },
  )
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /started before 1/ }))?.text).toBe('! started before 1')
  await ui.unmount()
})

test('the chat draws a turn line, collapsible reasoning and tool output/diffs', async ($, on) => {
  seed(
    on,
    [agent('ses_a', 'running', { title: '1. Fix it', tasks: [{ content: 'Fix it', status: 'in_progress' }] })],
    undefined,
    undefined,
    {
      openAgent: 'ses_a',
      plan: { shape: 'plan-1', value: { ...PLAN, tasks: [{ id: 1, title: 'Fix it', persona: 'builder', effort: 'high', after: [] }] } },
      planView: { shape: 'plan-view-1', value: { isCollapsed: false } },
      history: {
        shape: 'history-3',
        value: {
          id: 'ses_a',
          total: 4,
          entries: [
            { kind: 'prompt', text: 'Fix it' },
            {
              kind: 'reasoning',
              id: 'reasoning-r',
              text: 'Why\nbecause',
              messageId: 'a1',
              tokens: 1200,
              cost: 0.004,
              timeCreated: 0,
              timeCompleted: 12000,
            },
            {
              kind: 'tool',
              text: 'bash',
              detail: 'ls',
              id: 'tool-p',
              messageId: 'a1',
              output: 'alpha\nbeta',
              diff: '--- a\n+++ b\n+line',
            },
            { kind: 'reply', text: 'Done', messageId: 'a1' },
          ],
        },
      },
      chatView: { shape: 'chat-view-2', value: { isTasksOpen: false, expanded: ['reasoning-r', 'bash ls'] } },
    },
  )
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const text = async (t: RegExp) => (await ui.find({ type: 'Text', text: t }))?.text

  expect(await text(/Turn 1/)).toBe('── Turn 1 · 12s · 1.2k tok · $0.004 ──')
  expect(await ui.find({ key: 'thinking-reasoning-r' })).toBeDefined()
  expect((await ui.find({ key: 'thinking-reasoning-r' }))?.props.label).toBe('Thinking ↓')
  expect(await text(/^Why/)).toBe('Why\nbecause')
  expect(await text(/^alpha$/)).toBe('alpha')
  expect(await text(/^beta$/)).toBe('beta')
  expect((await ui.find({ type: 'Text', text: /^\+line/ }))?.props.color).toBe('success')
  await ui.unmount()
})

test('the plan view renders on every surface and at a narrow width', async ($, on) => {
  seed(
    on,
    [agent('ses_1', 'running', { title: '1. Scout the current API', tasks: [{ content: 'Scout', status: 'in_progress' }], question: undefined })],
    undefined,
    undefined,
    {
      plan: { shape: 'plan-1', value: PLAN },
      planView: { shape: 'plan-view-1', value: { isCollapsed: false } },
    },
  )

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface, props: { ...PANE.props, bodyColumns: 40 } })
    expect((await ui.find({ type: 'Text', text: /^Ride Verdict MVP/ }))?.text).toBe('Ride Verdict MVP')
    expect((await ui.find({ type: 'Text', text: /^Planned/ }))?.text).toBe('Planned · 3 · 0 done')
    expect(await ui.find({ key: 'stat-cost' })).toBeDefined()
    await ui.unmount()
  }
})
