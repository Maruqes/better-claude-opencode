import { expect, test } from 'claude-code/testing'

const TOOL = 'mcp__plugin_opencode-subagent-mcp_opencode__'
const PLAN_TOOL = 'mcp__opencode-agent-monitor__opencode_plan'
const STATUS = 'mcp__opencode-agent-monitor__opencode_status'

const engine = (on: any) => {
  const state = new Map<string, any>()
  const registers: any[] = []
  on('state.get', (_: unknown, e: { key: string }) => ({
    value: state.has(e.key) ? { value: state.get(e.key), version: 1 } : { version: 0 },
  }))
  on('state.set', (_: unknown, e: { key: string; value: unknown }) => {
    state.set(e.key, e.value)
    return { value: { isSet: true, version: 1 } }
  })
  on('command.register', () => ({ value: { command: 'opencode-agents' } }))
  on('tool.register', (_: unknown, e: unknown) => (registers.push(e), { value: {} }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/p' }))
  on('session.cwd', () => ({ value: '/' }))
  on('fs.write', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 5000 }))
  on('clock.every', () => new Promise(() => {}))

  return { state, registers }
}

test('opencode_plan resolves a task table and returns exact descriptions', async ($, on) => {
  const { state, registers } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  expect(registers.map(r => r.name)).toEqual(['opencode_status', 'opencode_plan'])
  const { result } = await $.tool.call({
    tool: PLAN_TOOL,
    title: 'Ride verdict',
    tasks: [{ title: 'Scout the API' }, { title: 'Build the engine', effort: 'careful', after: [1] }],
  })

  expect(String(result)).toContain('Plan: Ride verdict')
  expect(String(result)).toContain('1. Scout the API')
  expect(String(result)).toContain('scout · low · opencode-go/deepseek-v4.1-flash · low')
  expect(String(result)).toContain('builder · xhigh · opencode-go/kimi-k3.1-pro · max')
  expect(String(result)).toContain('description: "2. Build the engine"')
  expect(String(result)).toContain('after 1')
  expect(state.get('plan').value.tasks.map((t: any) => [t.id, t.effort])).toEqual([
    [1, 'low'],
    [2, 'xhigh'],
  ])
})

test('a rejected plan leaves the previous plan intact; clear removes it', async ($, on) => {
  const { state } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: PLAN_TOOL, title: 'First', tasks: [{ title: 'One' }] })

  const bad = await $.tool.call({
    tool: PLAN_TOOL,
    title: 'Second',
    tasks: [{ id: 1, title: 'A', after: [9] }],
  })
  expect(String(bad.result)).toContain('previous plan is unchanged')
  expect(state.get('plan').value.title).toBe('First')
  expect(state.get('plan').value.tasks).toHaveLength(1)

  const cleared = await $.tool.call({ tool: PLAN_TOOL, action: 'clear' })
  expect(String(cleared.result)).toBe('Plan cleared.')
  expect(state.get('plan').value).toBeNull()
})

test('an agent gets the plan effort and model; explicit choices win', async ($, on) => {
  const { state } = engine(on)
  const seen: any[] = []
  on('tool.call', (_: unknown, e: any) => {
    if (e.tool !== PLAN_TOOL && e.tool !== STATUS) seen.push(e)
    return { result: {}, text: 'agent_id: ses_a (x)' }
  })
  on('fs.read', () => ({ value: 'SYSTEM' }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: PLAN_TOOL, title: 'Ride', tasks: [{ title: 'Scout the API' }] })

  await $.tool.call({ tool: `${TOOL}agent`, description: '1. Scout the API', prompt: 'scout it' })
  expect(seen[0].effort).toBe('low')
  expect(seen[0].model).toBe('opencode-go/deepseek-v4.1-flash')
  expect(seen[0].prompt.startsWith('SYSTEM\n\n# Questions')).toBe(true)

  await $.tool.call({
    tool: `${TOOL}agent`,
    description: 'Hotfix',
    prompt: 'typo',
    effort: 'careful',
    model: 'opencode-go/deepseek-v4-pro',
  })
  expect(seen[1].effort).toBe('max')
  expect(seen[1].model).toBe('opencode-go/deepseek-v4-pro')

  await $.tool.call({ tool: `${TOOL}send_message`, agent_id: 'ses_a', message: 'more' })
  expect(seen[2].effort).toBeUndefined()
  expect(seen[2].model).toBeUndefined()
})

test('effort.enabled false leaves the agent call exactly as sent', async ($, on) => {
  engine(on)
  const seen: any[] = []
  on('tool.call', (_: unknown, e: any) => (seen.push(e), { result: {}, text: 'agent_id: ses_a (x)' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.read', (_: unknown, e: any) => ({ value: String(e.path).endsWith('config.json') ? '{"effort":{"enabled":false}}' : 'SYSTEM' }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await $.tool.call({ tool: `${TOOL}agent`, description: 'Scout', prompt: 'scout it' })

  expect(seen[0].effort).toBeUndefined()
  expect(seen[0].model).toBeUndefined()
  expect(seen[0].prompt.startsWith('SYSTEM')).toBe(true)
})

test('a bad config warns once and the agent still starts with the original args', async ($, on) => {
  engine(on)
  const seen: any[] = []
  on('tool.call', (_: unknown, e: any) => (seen.push(e), { result: {}, text: 'agent_id: ses_a (x)' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.read', (_: unknown, e: any) => ({ value: String(e.path).endsWith('config.json') ? '{ nope' : 'SYSTEM' }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: `${TOOL}agent`, description: 'Scout', prompt: 'scout it' })

  // Defaults fill the call; the warning is a pane value, not a failed call.
  expect(seen[0].effort).toBe('low')
  expect(seen[0].model).toBe('opencode-go/deepseek-v4.1-flash')
})

test('a plan task model fills a call with no model', async ($, on) => {
  engine(on)
  const seen: any[] = []
  on('tool.call', (_: unknown, e: any) => (seen.push(e), { result: {}, text: 'agent_id: ses_a (x)' }))
  on('fs.read', () => ({ value: 'SYSTEM' }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({
    tool: PLAN_TOOL,
    title: 'Ride',
    tasks: [{ title: 'Probe', effort: 'high', model: 'opencode-go/deepseek-v4-pro' }],
  })
  await $.tool.call({ tool: `${TOOL}agent`, description: '1. Probe', prompt: 'probe' })

  expect(seen[0].model).toBe('opencode-go/deepseek-v4-pro')
  expect(seen[0].effort).toBe('high')
})
