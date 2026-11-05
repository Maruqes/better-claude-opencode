import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'better-claude-opencode',
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
const seed = (on: any, statuses: object[], warning?: string, stopError?: string) =>
  on('state.get', (_: unknown, e: { key: string }) => {
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
    expect(await text(/^●/)).toBe('●  Task ses_r  deepseek-flash  1m12s  bash')
    expect(await text(/^✓/)).toBe('✓  Task ses_f  deepseek-flash  1m12s')
    expect(await text(/^■/)).toBeDefined()
    expect(await text(/^\?/)).toBeDefined()
    expect((await ui.findAll({ type: 'Text', text: /pytest/ })).length).toBe(1)
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

const engine = (on: any) => {
  const opened: unknown[] = []
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
  on('clock.now', () => ({ value: 1000 }))
  on('clock.every', () => new Promise(() => {}))

  return { opened, tracked: () => state.get('tracked')?.value }
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

const STATUS = 'mcp__better-claude-opencode__opencode_status'
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
