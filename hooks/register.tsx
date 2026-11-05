import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { AgentState, AgentStatus, TrackedAgent } from '../types'
import { createDb, SESSION_ID } from './db'
import { formatCounts, formatElapsed, isActive, summarize } from './summary'
import { addAgent, adoptProvisional, confirmAgent, extractAgentId } from './tracker'

const PANE = 'opencode-agents'
const TITLE = 'opencode agents'
const SERVER = 'plugin:opencode-subagent-mcp:opencode'
const TOOL_PREFIX = 'mcp__plugin_opencode-subagent-mcp_opencode__'
const POLL_MS = 2000
const GLYPHS: Record<AgentState, string> = { running: '●', finished: '✓', stopped: '■', unknown: '?' }
const NO_ROWS = { sessions: [], messages: [], parts: [] }

const tracked = atom({ plugin: 'better-claude-opencode', key: 'tracked' } as const, [], { shape: 'tracked-1' })
const statuses = atom({ plugin: 'better-claude-opencode', key: 'statuses' } as const, [], { shape: 'statuses-1' })
const warning = atom({ plugin: 'better-claude-opencode', key: 'warning' } as const, '')

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export const register: Register = on => {
  // $ cannot be stored or passed, so the work that outlives a dispatch closes over
  // session.start's $. A reload resets this; session.start rebuilds it from $.state.
  let tracking: {
    track(change: (list: TrackedAgent[]) => TrackedAgent[]): Promise<void>
    startPolling(): void
  }
  const calls = new Map<string, { start: number; adopts: boolean }>()
  // A call ended during a poll, so that poll's view is stale: poll once more.
  let isStale = false

  on('session.start', async ($, e, next) => {
    const db = createDb({ process: { run: argv => $.process.run(argv) } })
    let timer: { cancel(): void } | undefined
    let isPolling = false

    const track = async (change: (list: TrackedAgent[]) => TrackedAgent[]) => {
      const wasEmpty = !(await read($, tracked)).length
      const list = await update($, tracked, change)
      // Not awaited: a pane that cannot open must not affect the MCP call.
      if (wasEmpty && list.length) void $.ui.open({ id: PANE, title: TITLE }).catch(() => {})
    }

    const poll = async () => {
      if (isPolling) return
      isPolling = true
      isStale = false
      try {
        let error: string | undefined
        const cwd = await $.session.cwd()
        for (const [callId, call] of calls) {
          if (!call.adopts) continue
          const found = await db.findRootSessions(cwd, call.start)
          if (found.ok) {
            await track(list => (calls.has(callId) ? adoptProvisional(list, found.ids, callId) : list))
          } else error = found.error
        }

        const ids = (await read($, tracked)).map(a => a.id)
        const rows = await db.fetchRows(ids)
        if (rows.ok) {
          const now = await $.clock.now()
          await update($, statuses, () => ids.map(id => summarize(id, rows, now)))
        } else error ??= rows.error
        await update($, warning, () => (error ? `Activity unavailable: ${error}` : ''))

        const known = await read($, statuses)
        const isIdle = !(await read($, tracked)).some(a => isActive(a.id, known))
        if (isIdle && !calls.size && !isStale) {
          timer?.cancel()
          timer = undefined
        }
      } catch (error) {
        await update($, warning, () => `Activity unavailable: ${errorText(error)}`)
      } finally {
        isPolling = false
      }
    }

    const startPolling = () => {
      timer ??= $.clock.every(POLL_MS, () => void poll())
    }

    tracking = { track, startPolling }
    await $.command.register({
      name: 'opencode-agents',
      description: "Show this session's opencode subagents in a pane",
    })
    const known = await read($, statuses)
    if ((await read($, tracked)).some(a => isActive(a.id, known))) startPolling()

    return next(e)
  })

  on('command.run', { command: 'opencode-agents' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'opencode agents pane opened.' }
  })

  for (const name of ['agent', 'send_message', 'wait']) {
    on('tool.call', { tool: `${TOOL_PREFIX}${name}` }, async ($, e, next) => {
      const callId = e.tool_use_id
      calls.set(callId, { start: await $.clock.now(), adopts: name === 'agent' })
      const { agent_id: id } = e as { agent_id?: unknown }
      if (name !== 'agent' && typeof id === 'string' && SESSION_ID.test(id)) {
        await tracking.track(list => addAgent(list, id))
      }
      tracking.startPolling()

      let text: string | undefined
      try {
        const ran = await next(e)
        text = ran.text

        return ran
      } finally {
        calls.delete(callId)
        isStale = true
        await tracking.track(list => confirmAgent(list, callId, text && extractAgentId(text)))
        tracking.startPolling()
      }
    })
  }

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const known = await read($, statuses)
    const message = await read($, warning)
    const agents = (await read($, tracked)).map(
      a => known.find(s => s.id === a.id) ?? summarize(a.id, NO_ROWS, 0),
    )

    const stop = async (agent: AgentStatus) => {
      try {
        const { content, isError } = await $.mcp.call(SERVER, 'stop', { agent_id: agent.id })
        if (isError) throw new Error(content.map(c => c.text ?? '').join(' ').trim())
        const text = `The user stopped opencode agent ${agent.id} (${agent.title}) from the pane.`
        await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } })
      } catch (error) {
        await update($, warning, () => `Stop failed: ${errorText(error)}`)
      }
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold>opencode agents</Text>
          <Text dimColor>{formatCounts(agents)}</Text>
        </Box>
        {agents.length === 0 && <Text dimColor>No agents yet</Text>}
        {agents.map(agent => (
          <Box flexDirection="column">
            <Box flexDirection="row" justifyContent="space-between">
              <Text>
                {[
                  GLYPHS[agent.state],
                  agent.title,
                  agent.model,
                  formatElapsed(agent.elapsedMs),
                  agent.currentTool,
                ]
                  .filter(Boolean)
                  .join('  ')}
              </Text>
              {agent.state === 'running' && (
                <Button key={`stop-${agent.id}`} label="Stop" onPress={() => void stop(agent)} />
              )}
            </Box>
            {agent.state === 'running' && agent.recent && <Text dimColor>  {agent.recent}</Text>}
          </Box>
        ))}
        {message && <Text color="yellow">! {message}</Text>}
      </Box>
    )
  })
}
