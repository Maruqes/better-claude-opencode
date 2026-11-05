import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { AgentStatus, Plan, PlanView, TrackedAgent } from '../types'
import { createDb, SESSION_ID } from './db'
import type { SessionRow } from './db'
import { DEFAULT_CONFIG, loadConfig } from './config'
import type { MonitorConfig } from './config'
import { effortForAgent, formatPlanSet, linkTask, normalizePlan, resolveVariant } from './plan'
import { renderPane } from './pane'
import {
  composePrompt,
  formatChat,
  formatPrompts,
  formatReport,
  isActive,
  summarize,
} from './summary'
import {
  addAgent,
  adoptProvisional,
  agentsToWake,
  confirmAgent,
  extractAgentId,
  markRunning,
  reportedAgentId,
  resultText,
  pendingText,
  PICKER_RULE,
  wakeText,
} from './tracker'

const PANE = 'opencode-agents'
const TITLE = 'opencode agents'
const SERVER = 'plugin:opencode-subagent-mcp:opencode'
const TOOL_PREFIX = 'mcp__plugin_opencode-subagent-mcp_opencode__'
const PLUGIN_TOOL_PREFIX = 'mcp__opencode-agent-monitor__'
const STATUS_TOOL = 'opencode_status'
const PLAN_TOOL = 'opencode_plan'
const POLL_MS = 2000
const PROMPT_DIR = '.opencode-monitor'
const NO_ROWS = { sessions: [], messages: [], parts: [], todos: [] }
const DELEGATION_SECTION = {
  id: 'opencode-agent-monitor:delegation',
  scope: 'session',
  text: `# Delegating to opencode
When you start an opencode agent, write it a short prompt made for this job: the goal, the files in scope, the constraints, how to verify, then a numbered list of 2 to 6 concrete tasks. End the prompt with: "Before any other work, call todowrite with exactly these tasks. Keep exactly one in_progress, and mark each completed as soon as it is done."
The user's progress bar reads those todos, and ${STATUS_TOOL} reports the task in progress.
An agent in doubt ends its report with a "QUESTION:" paragraph, and stays blocked until you reply. ${PICKER_RULE} A reply in chat never reaches the agent.
An agent's work is done only when all its tasks are. If its report leaves tasks open or its work fails your review, use send_message on the same agent_id to continue, rather than starting a new agent or stopping there. Repeat until done, or tell the user why it cannot be.`,
} as const
const PLAN_SECTION = {
  id: 'opencode-agent-monitor:plan',
  scope: 'session',
  text: `# Planning a multi-agent job
Before you start a job that needs more than one opencode agent, call the opencode_plan tool with an action of "set": give the plan a short title and 1 to 10 numbered tasks. Each task needs a title, and "after" lists the task ids it waits for; persona is optional. Rate every task's effort yourself: "low" for mechanical edits, renames and running checks; "medium" for standard features and bugs with a known cause; "high" for delicate multi-file work where invariants matter; "xhigh" for messy or unfamiliar code and root-cause debugging; "max" only for very hard problems. Use "minimal" for trivial lookups. An effort you leave out is guessed from the title. The tool answers with every task's resolved persona, effort, model and variant, plus the exact description to use.
Then start exactly one agent per task, through the MCP agent tool, with that description copied exactly as "<n>. <title>" and the model and effort the plan reported. Start a task only after the tasks in its "after" list are finished. The plan is advisory and visible to the person; it does not schedule anything. Keep using todowrite for the agent's own progress as described above.`,
} as const

const tracked = atom({ plugin: 'opencode-agent-monitor', key: 'tracked' } as const, [], { shape: 'tracked-1' })
const statuses = atom({ plugin: 'opencode-agent-monitor', key: 'statuses' } as const, [], { shape: 'statuses-1' })
const delivered = atom({ plugin: 'opencode-agent-monitor', key: 'delivered' } as const, [], { shape: 'delivered-1' })
const history = atom(
  { plugin: 'opencode-agent-monitor', key: 'history' } as const,
  { id: '', entries: [], total: 0 },
  { shape: 'history-3' },
)
const prompts = atom({ plugin: 'opencode-agent-monitor', key: 'prompts' } as const, [], { shape: 'prompts-1' })
const openAgent = atom({ plugin: 'opencode-agent-monitor', key: 'openAgent' } as const, '')
const chatView = atom(
  { plugin: 'opencode-agent-monitor', key: 'chatView' } as const,
  { isTasksOpen: false, expanded: [] },
  { shape: 'chat-view-2' },
)
const plan = atom({ plugin: 'opencode-agent-monitor', key: 'plan' } as const, null, { shape: 'plan-1' })
const planView = atom(
  { plugin: 'opencode-agent-monitor', key: 'planView' } as const,
  { isCollapsed: false },
  { shape: 'plan-view-1' },
)
const warning = atom({ plugin: 'opencode-agent-monitor', key: 'warning' } as const, '')
const stopError = atom({ plugin: 'opencode-agent-monitor', key: 'stopError' } as const, '')

// Loaded at session start; a warning is shown once and then defaults stay in force.
let config: MonitorConfig = DEFAULT_CONFIG

// One row of tolerance, so a half-drawn last line still counts as the bottom.
export const endsAtBottom = (e: { offset: number; contentRows: number; bodyRows: number }) =>
  e.offset >= e.contentRows - e.bodyRows - 1

const promptPath = (id: string) => `${PROMPT_DIR}/${id}/prompt.txt`

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

const isPlan = (value: unknown): value is Plan =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as Plan).tasks) &&
  typeof (value as Plan).title === 'string'

// The plan fills a missing effort, inference fills a missing plan; Claude's own
// choice always wins, and a failure here leaves the call exactly as sent.
async function withEffort($: any, e: any) {
  if (!config.effort.enabled) return e
  try {
    const stored = await read($, plan)
    const known = isPlan(stored) ? stored : null
    const description = typeof e.description === 'string' ? e.description : ''
    const prompt = typeof e.prompt === 'string' ? e.prompt : ''
    const effort = effortForAgent(known, description, prompt, e.effort)
    const task = known ? linkTask(known, description) : undefined
    const row = config.effort.table[effort]
    // A plan task's own model applies only while its effort is the one chosen.
    const plannedModel = task && task.effort === effort ? task.model || row.model : row.model
    const model = typeof e.model === 'string' && e.model.trim() ? e.model.trim() : plannedModel
    const variant = resolveVariant(row.variant, model, config.effort.variants)

    return { ...e, effort: variant, model }
  } catch {
    return e
  }
}

// TEMP-DEBUG start
const debugLines: string[] = ['module loaded, origin-kind build']
async function debugLog($: any, line: string) {
  debugLines.push(line)
  try {
    await $.fs.write(`${await $.session.cwd()}/.opencode-monitor/debug.log`, `${debugLines.join('\n')}\n`)
  } catch (error) {
    try {
      await $.ui.toast(`debug log failed: ${String(error)}`)
    } catch {}
  }
}
// TEMP-DEBUG end

export const register: Register = on => {
  // $ cannot be stored or passed, so the work that outlives a dispatch closes over
  // session.start's $. A reload resets this; session.start rebuilds it from $.state.
  let tracking: {
    track(change: (list: TrackedAgent[]) => TrackedAgent[]): Promise<void>
    startPolling(): void
    fetchRows: ReturnType<typeof createDb>['fetchRows']
    loadHistory(id: string, isOpening?: boolean): Promise<string | undefined>
  }
  // Whether the pane window ends at the bottom, so new chat entries keep it there.
  let isFollowing = true
  const calls = new Map<string, { start: number; adopts: boolean; id?: string }>()
  // A call ended during a poll, so that poll's view is stale: poll once more.
  let isStale = false

  on('session.start', async ($, e, next) => {
    const db = createDb({ process: { run: argv => $.process.run(argv) } })
    let timer: { cancel(): void } | undefined
    let isPolling = false
    // When each agent was first polled, close enough to when it was first tracked.
    const firstSeen = new Map<string, number>()
    // The newest user message each agent's prompt.txt holds.
    const saved = new Map<string, number | null>()

    const loaded = await loadConfig($).catch(error => ({ config: DEFAULT_CONFIG, warning: errorText(error) }))
    config = loaded.config
    if (loaded.warning) await update($, warning, () => `Effort config: ${loaded.warning}`)

    const track = async (change: (list: TrackedAgent[]) => TrackedAgent[]) => {
      const wasEmpty = !(await read($, tracked)).length
      const list = await update($, tracked, change)
      // Not awaited: a pane that cannot open must not affect the MCP call.
      if (wasEmpty && list.length) void $.ui.open({ id: PANE, title: TITLE }).catch(() => {})
    }

    // Resolves to the failure, if any: database failures are values.
    const loadHistory = async (id: string, isOpening = false) => {
      const found = await db.fetchHistory(id)
      if (!found.ok) return found.error
      const before = JSON.stringify(await read($, history))
      const after = await update($, history, () => ({
        id,
        entries: formatChat(found.rows),
        total: found.rows[0]?.total ?? 0,
      }))
      if (isOpening || (isFollowing && JSON.stringify(after) !== before)) {
        // `end` keeps up with a tree that grows, so it holds across the redraw that follows.
        // A refused or failed scroll must never fail a hook.
        await $.ui.scroll({ in: PANE, to: 'end' }).catch(() => {})
      }
    }

    // Only confirmed agents: a provisional id may be an unrelated session.
    const savePrompts = async (sessions: SessionRow[]) => {
      try {
        const root = await $.session.root()
        for (const { id } of (await read($, tracked)).filter(a => !a.callId)) {
          const newest = sessions.find(s => s.id === id)?.run_started
          if (newest === undefined || saved.get(id) === newest) continue
          const found = await db.fetchPrompts(id)
          if (!found.ok) return found.error
          const text = formatPrompts(found.rows)
          if (!text) continue
          await $.fs.write(`${root}/${PROMPT_DIR}/.gitignore`, '*\n')
          await $.fs.write(`${root}/${promptPath(id)}`, text)
          // A message can land before its parts: leave it unsaved so the next poll retries.
          if (found.rows.findLast(r => r.role === 'user')?.time_created === newest) saved.set(id, newest)
          await update($, prompts, list => (list.includes(id) ? list : [...list, id]))
        }
      } catch (error) {
        return errorText(error)
      }
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
        if (rows.ok) error ??= await savePrompts(rows.sessions)
        const open = await read($, openAgent)
        if (open) error ??= await loadHistory(open)
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

    tracking = { track, startPolling, fetchRows: db.fetchRows, loadHistory }
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
    await $.tool.register({
      name: PLAN_TOOL,
      description:
        'Register the visible plan for a multi-agent job: a title and 1 to 50 numbered tasks, each with an effort you rate (minimal, low, medium, high, xhigh or max), an optional persona and model, and advisory "after" dependencies. The answer lists every resolved task and the exact description to pass to the MCP agent tool. Use action "clear" to remove it.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['set', 'clear'] },
          title: { type: 'string' },
          tasks: {
            type: 'array',
            minItems: 1,
            maxItems: 50,
            items: {
              type: 'object',
              properties: {
                id: { type: 'number' },
                title: { type: 'string' },
                persona: { type: 'string', enum: ['scout', 'builder', 'tester', 'reviewer', 'general'] },
                effort: { type: 'string', enum: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] },
                after: { type: 'array', items: { type: 'number' } },
                model: { type: 'string' },
              },
              required: ['title'],
            },
          },
        },
      },
    })
    const known = await read($, statuses)
    if ((await read($, tracked)).some(a => isActive(a.id, known))) startPolling()

    return next(e)
  })

  // Only a move that ends short of the bottom unsets it; our own `end` scroll leaves it be.
  on('ui.scroll', { requestId: PANE }, async (_$, e, next) => {
    if (e.origin.kind === 'person') isFollowing = endsAtBottom(e)

    return next(e)
  })

  // Every prompt has an origin; a plugin's is skipped as a wake already carries its agents.
  // TEMP-DEBUG start
  on('turn.start', async ($, e, next) => {
    await debugLog($, `turn.start agent=${e.agentId ?? 'main'}`)
    return next(e)
  })
  // TEMP-DEBUG end
  on('prompt.submit', async ($, e, next) => {
    // TEMP-DEBUG
    await debugLog($, `prompt.submit origin=${JSON.stringify(e.origin)} command=${e.command?.name} meta=${e.isMeta} text=${e.text.slice(0, 30)} states=${JSON.stringify((await read($, statuses)).map(s => [s.id, s.state]))} inflight=${JSON.stringify([...calls.values()].map(c => c.id))}`)
    if (e.origin?.kind === 'plugin' || e.command) return next(e)
    const pending = pendingText(await read($, statuses), [...calls.values()].flatMap(c => c.id ?? []))
    // TEMP-DEBUG
    await debugLog($, `pending length=${pending.length}`)

    return next(pending ? { ...e, context: [...(e.context ?? []), pending] } : e)
  })

  on('prompt.compose', async ($, e, next) => {
    const { sections } = await next(e)

    return { sections: [...sections, DELEGATION_SECTION, PLAN_SECTION] }
  })

  on('command.run', { command: 'opencode-agents' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'opencode agents pane opened.' }
  })

  on('tool.call', { tool: `mcp__opencode-agent-monitor__${STATUS_TOOL}` }, async ($, e) => {
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

  on('tool.call', { tool: `${PLUGIN_TOOL_PREFIX}${PLAN_TOOL}` }, async ($, e) => {
    const { action, title, tasks } = e as { action?: unknown; title?: unknown; tasks?: unknown }
    try {
      if (action === 'clear') {
        await update($, plan, () => null)
        await update($, planView, () => ({ isCollapsed: false }))

        return { result: 'Plan cleared.' }
      }
      const normalized = normalizePlan({ title, tasks }, await $.clock.now())
      if (!normalized.ok) {
        return { result: `Plan not set: ${normalized.error}. The previous plan is unchanged.` }
      }
      await update($, plan, () => normalized.plan)
      await update($, planView, () => ({ isCollapsed: false }))

      return { result: formatPlanSet(normalized.plan, config.effort) }
    } catch (error) {
      return { result: `Plan not set: ${errorText(error)}. The previous plan is unchanged.` }
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
        // A template that cannot be read must not stop the call; the rule still goes out.
        const template = async () =>
          $.fs.read(`${$.plugin.root}/prompts/system.txt`).catch(async error => {
            await update($, warning, () => `Prompt template unavailable: ${errorText(error)}`)

            return ''
          })
        let outgoing: any = e
        if (name === 'agent') {
          outgoing = await withEffort($, e)
          const { prompt } = outgoing as { prompt?: unknown }
          if (typeof prompt === 'string') outgoing = { ...outgoing, prompt: composePrompt(await template(), prompt) }
        }
        const ran = await next(outgoing)
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
    const known = await read($, statuses)
    const message = await read($, warning)
    const stopMessage = await read($, stopError)
    const opened = await read($, openAgent)
    const written = await read($, prompts)
    const log = await read($, history)
    const view = await read($, chatView)
    const storedPlan = await read($, plan)
    const storedView = await read($, planView)
    const activePlan = isPlan(storedPlan) ? storedPlan : null
    const activeView: PlanView =
      typeof storedView === 'object' && storedView !== null && typeof (storedView as PlanView).isCollapsed === 'boolean'
        ? (storedView as PlanView)
        : { isCollapsed: false }
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

    // A finished agent is no longer polled, so opening one loads it here.
    const openChat = async (id: string) => {
      await update($, chatView, () => ({ isTasksOpen: false, expanded: [] }))
      await update($, openAgent, () => id)
      isFollowing = true
      const error = await tracking.loadHistory(id, true)
      if (error) await update($, warning, () => `Activity unavailable: ${error}`)
    }
    const back = async () => {
      await update($, openAgent, () => '')
      await $.ui.scroll({ in: PANE, to: 'start' }).catch(() => {})
    }
    const jump = async () => {
      isFollowing = true
      await $.ui.scroll({ in: PANE, to: 'end' }).catch(() => {})
    }
    const toggleTasks = () => update($, chatView, v => ({ ...v, isTasksOpen: !v.isTasksOpen }))
    const toggle = (id: string) =>
      update($, chatView, v => ({
        ...v,
        expanded: v.expanded.includes(id) ? v.expanded.filter(x => x !== id) : [...v.expanded, id],
      }))
    const clearPlan = async () => {
      await update($, plan, () => null)
      await update($, planView, () => ({ isCollapsed: false }))
    }
    const togglePlan = () => update($, planView, v => ({ ...v, isCollapsed: !v.isCollapsed }))

    return renderPane($, e, {
      statuses: agents,
      warning: message,
      stopError: stopMessage,
      openAgent: opened,
      prompts: written,
      history: log,
      chatView: view,
      plan: activePlan,
      planView: activeView,
      isFollowing,
      effort: config.effort,
      openChat,
      stop,
      back,
      jump,
      toggleTasks,
      toggle,
      clearPlan,
      togglePlan,
    })
  })
}
