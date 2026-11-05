import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { AgentState, AgentStatus, TrackedAgent } from '../types'
import { createDb, SESSION_ID } from './db'
import { formatCounts, formatElapsed, formatReport, isActive, summarize } from './summary'
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
} from './tracker'

const PANE = 'opencode-agents'
const TITLE = 'opencode agents'
const SERVER = 'plugin:opencode-subagent-mcp:opencode'
const TOOL_PREFIX = 'mcp__plugin_opencode-subagent-mcp_opencode__'
const STATUS_TOOL = 'opencode_status'
const POLL_MS = 2000
const GLYPHS: Record<AgentState, string> = { running: '●', finished: '✓', stopped: '■', unknown: '?' }
const NO_ROWS = { sessions: [], messages: [], parts: [] }

const tracked = atom({ plugin: 'better-claude-opencode', key: 'tracked' } as const, [], { shape: 'tracked-1' })
const statuses = atom({ plugin: 'better-claude-opencode', key: 'statuses' } as const, [], { shape: 'statuses-1' })
const delivered = atom({ plugin: 'better-claude-opencode', key: 'delivered' } as const, [], { shape: 'delivered-1' })
const warning = atom({ plugin: 'better-claude-opencode', key: 'warning' } as const, '')
const stopError = atom({ plugin: 'better-claude-opencode', key: 'stopError' } as const, '')

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export const register: Register = on => {
  // $ cannot be stored or passed, so the work that outlives a dispatch closes over
  // session.start's $. A reload resets this; session.start rebuilds it from $.state.
  let tracking: {
    track(change: (list: TrackedAgent[]) => TrackedAgent[]): Promise<void>
    startPolling(): void
    fetchRows: ReturnType<typeof createDb>['fetchRows']
  }
  const calls = new Map<string, { start: number; adopts: boolean; id?: string }>()
  // A call ended during a poll, so that poll's view is stale: poll once more.
  let isStale = false

  on('session.start', async ($, e, next) => {
    const db = createDb({ process: { run: argv => $.process.run(argv) } })
    let timer: { cancel(): void } | undefined
    let isPolling = false
    // When each agent was first polled, close enough to when it was first tracked.
    const firstSeen = new Map<string, number>()

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
        const now = await $.clock.now()
        for (const id of ids) if (!firstSeen.has(id)) firstSeen.set(id, now)
        const rows = await db.fetchRows(ids)
        let wake: string[] = []
        // Rows read before a call ended are stale, and could wake for the wrong run.
        if (rows.ok && !isStale) {
          const previous = await read($, statuses)
          const current = await update($, statuses, () => ids.map(id => summarize(id, rows, now)))
          const list = await read($, tracked)
          const received = await read($, delivered)
          // After the reads: a call writes `delivered` before it leaves `calls`.
          const inFlight = [
            ...[...calls.values()].flatMap(c => c.id ?? []),
            ...list.filter(a => a.callId && calls.has(a.callId)).map(a => a.id),
          ]
          wake = agentsToWake(previous, current, received, inFlight)
          if (wake.length) await update($, delivered, done => [...done, ...wake])
        } else if (!rows.ok) error ??= rows.error
        await update($, warning, () => (error ? `Activity unavailable: ${error}` : ''))
        if (wake.length) {
          const failed = (reason: unknown) => update($, warning, () => `Wake failed: ${errorText(reason)}`)
          // Not awaited: a submit resolves when its turn starts, which must not hold up polling.
          void $.prompt
            .submit({ text: wakeText(wake, await read($, statuses)) })
            .then(result => (result.drop === undefined ? undefined : failed(result.drop)))
            .catch(failed)
            .catch(() => {})
        }

        const known = await read($, statuses)
        const isIdle = !(await read($, tracked)).some(a =>
          isActive(a.id, known, now - (firstSeen.get(a.id) ?? now)),
        )
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

    tracking = { track, startPolling, fetchRows: db.fetchRows }
    await $.command.register({
      name: 'opencode-agents',
      description: "Show this session's opencode subagents in a pane",
    })
    await $.tool.register({
      name: STATUS_TOOL,
      description:
        "Report this session's opencode agents from fresh data: state, elapsed time, current tool and a recent excerpt. Omit agent_id for all tracked agents; detail adds the last 10 activity lines.",
      inputSchema: {
        type: 'object',
        properties: { agent_id: { type: 'string' }, detail: { type: 'boolean' } },
      },
    })
    const known = await read($, statuses)
    if ((await read($, tracked)).some(a => isActive(a.id, known))) startPolling()

    return next(e)
  })

  on('command.run', { command: 'opencode-agents' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'opencode agents pane opened.' }
  })

  on('tool.call', { tool: `mcp__better-claude-opencode__${STATUS_TOOL}` }, async ($, e) => {
    const { agent_id: id, detail } = e as { agent_id?: string; detail?: boolean }
    const unavailable = (error: unknown) =>
      `Activity unavailable: ${errorText(error)}. The MCP wait tool still works.`

    try {
      const list = (await read($, tracked)).map(a => a.id)
      const ids = id === undefined ? list : list.filter(known => known === id)
      if (!ids.length) {
        return {
          result: id === undefined ? 'No opencode agents tracked.' : `Agent ${id} is not tracked in this session.`,
        }
      }
      const rows = await tracking.fetchRows(ids)
      if (!rows.ok) return { result: unavailable(rows.error) }

      return { result: formatReport(ids, rows, await $.clock.now(), detail === true) }
    } catch (error) {
      return { result: unavailable(error) }
    }
  })

  for (const name of ['agent', 'send_message', 'wait']) {
    on('tool.call', { tool: `${TOOL_PREFIX}${name}` }, async ($, e, next) => {
      const callId = e.tool_use_id
      const { agent_id: id } = e as { agent_id?: unknown }
      const known = name !== 'agent' && typeof id === 'string' && SESSION_ID.test(id) ? id : undefined
      calls.set(callId, { start: await $.clock.now(), adopts: name === 'agent', ...(known && { id: known }) })
      if (known) await tracking.track(list => addAgent(list, known))
      if (known && name === 'send_message') await update($, delivered, list => list.filter(d => d !== known))
      tracking.startPolling()

      let text: string | undefined
      try {
        const ran = await next(e)
        text = resultText(ran)

        return ran
      } finally {
        const resultId = text && extractAgentId(text)
        const reported = text && reportedAgentId(text)
        if (reported) await update($, delivered, list => [...list.filter(d => d !== reported), reported])
        calls.delete(callId)
        isStale = true
        if (resultId && !reported) await update($, statuses, list => markRunning(list, resultId))
        await tracking.track(list => confirmAgent(list, callId, resultId))
        tracking.startPolling()
      }
    })
  }

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const known = await read($, statuses)
    const message = await read($, warning)
    const stopMessage = await read($, stopError)
    const agents = (await read($, tracked)).map(
      a => known.find(s => s.id === a.id) ?? summarize(a.id, NO_ROWS, 0),
    )

    const stop = async (agent: AgentStatus) => {
      try {
        const { content, isError } = await $.mcp.call(SERVER, 'stop', { agent_id: agent.id })
        if (isError) throw new Error(content.map(c => c.text ?? '').join(' ').trim())
        const text = `The user stopped opencode agent ${agent.id} (${agent.title}) from the pane.`
        await update($, stopError, () => '')
        await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } })
      } catch (error) {
        await update($, stopError, () => `Stop failed: ${errorText(error)}`)
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
        {stopMessage && <Text color="yellow">! {stopMessage}</Text>}
      </Box>
    )
  })
}
