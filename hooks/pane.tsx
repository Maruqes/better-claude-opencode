import type {
  AgentHistory,
  AgentState,
  AgentStatus,
  ChatEntry,
  ChatView,
  Effort,
  Persona,
  Plan,
  PlanView,
} from '../types'
import type { EffortConfig } from './config'
import { fadedTextSvg, PROGRESS_TOP, progressSvg, robotSvg } from './mascot'
import type { RobotState } from './mascot'
import {
  descriptionOf,
  effortOfVariant,
  formatClock,
  formatCost,
  formatTokens,
  inferEffort,
  inferPersona,
  linkTask,
  planRows,
  planStats,
  resolvedTask,
  unplannedAgents,
} from './plan'
import type { PlanRow } from './plan'
import {
  clipText,
  wrapRows,
  formatCounts,
  formatElapsed,
  formatShortElapsed,
  formatTask,
  formatTurnCost,
  groupChat,
  progressOf,
} from './summary'
import type { ChatItem } from './summary'
import { DIFF_CHARS, OUTPUT_CHARS } from './db'

export const GLYPHS: Record<AgentState, string> = {
  running: '●',
  asking: '?',
  finished: '✓',
  stopped: '■',
  unknown: '?',
}
export const GLYPH_COLORS: Record<AgentState, string> = {
  running: 'suggestion',
  asking: 'warning',
  finished: 'success',
  stopped: 'warning',
  unknown: 'inactive',
}
const PERSONA_ASCII: Record<Persona, string> = {
  scout: '[S]',
  builder: '[B]',
  tester: '[T]',
  reviewer: '[R]',
  general: '[*]',
}
const EFFORT_COLORS: Record<Effort, string> = {
  minimal: 'subtle',
  low: 'success',
  medium: 'suggestion',
  high: 'warning',
  xhigh: 'error',
  max: 'warning',
}
const AVATAR_SIZE = 32
// Pixels taken from a bar's row by the avatar, gap, padding and border.
const CARD_INSET = 72
// The chat header pads one column each side on top of the card's 16px.
const HEADER_INSET = 32
const diffColor = (line: string) => {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'success'
  if (line.startsWith('-') && !line.startsWith('---')) return 'error'
  return line.startsWith('@@') ? 'suggestion' : undefined
}
const PROMPT_ROWS = 5
// No theme key names the background; this one is its colour on light and dark themes alike,
// and the pinned header must be opaque over the chat rows beneath it.
const HEADER_BACKGROUND = 'inverseText'
const DETAIL_BUDGET = 15_000
const OUTPUT_LINES = 6
const DIFF_LINES = 20

export type PaneContext = {
  statuses: AgentStatus[]
  warning: string
  stopError: string
  openAgent: string
  prompts: string[]
  history: AgentHistory
  chatView: ChatView
  plan: Plan | null
  planView: PlanView
  isFollowing: boolean
  effort: EffortConfig
  openChat(id: string): Promise<void>
  stop(agent: AgentStatus): Promise<void>
  back(): Promise<void>
  jump(): Promise<void>
  toggleTasks(): Promise<void>
  toggle(key: string): Promise<unknown>
  clearPlan(): Promise<unknown>
  togglePlan(): Promise<unknown>
}

const isSettled = (agent: AgentStatus | undefined) =>
  agent?.state === 'finished' || agent?.state === 'stopped'

// The elements and small pieces both the pane and the AbovePrompt band draw with.
function kit($: any, e: any) {
  const ui = $.ui.resolve(e)
  const { Box, Button, Markdown, Text } = ui
  // The terminal's element table has an `Svg` that draws nothing, so test the surface too.
  const Svg = e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : undefined
  const avatar = (persona: Persona, effort: Effort, state: RobotState) =>
    Svg ? (
      <Box flexShrink={0}>
        <Svg source={robotSvg(effort, state, AVATAR_SIZE)} alt={`${effort} effort robot, ${state}`} width={AVATAR_SIZE} height={AVATAR_SIZE} />
      </Box>
    ) : (
      <Text>{PERSONA_ASCII[persona]}</Text>
    )
  const progressBar = (key: string, percent: number, inset: number) => {
    if (!Svg) {
      return (
        <Box key={key} flexDirection="row" width="100%" height={1} backgroundColor="subtle">
          <Box width={`${percent}%`} height={1} backgroundColor="suggestion" />
        </Box>
      )
    }
    // Columns are about 8 CSS px; 7 stays narrow on purpose, and the box clips any excess.
    const width = Math.max(80, e.props.bodyColumns * 7 - inset)

    return (
      <Box key={key} width="100%" minWidth={0} overflow="hidden">
        <Svg source={progressSvg(width, percent)} alt={`${percent}% done`} width={width} height={6 + PROGRESS_TOP} />
      </Box>
    )
  }
  const metaLine = (effort: Effort, rest: unknown[], wrap = 'truncate-end') => (
    <Box flexDirection="row" columnGap={1}>
      <Text color={EFFORT_COLORS[effort]}>{effort}</Text>
      <Box flexShrink={1}>
        <Text dimColor wrap={wrap}>{['', ...rest.filter(Boolean)].join(' · ').trim()}</Text>
      </Box>
    </Box>
  )
  const effortOf = (agent: AgentStatus) => effortOfVariant(agent.variant) ?? inferEffort(agent.title)

  return { Box, Button, Markdown, Text, Svg, avatar, progressBar, metaLine, effortOf }
}
type Kit = ReturnType<typeof kit>

// The chat header: one function for the AbovePrompt band and for the in-flow fallback.
function chatHeader(k: Kit, ctx: PaneContext, current: AgentStatus) {
  const { Box, Button, Text, avatar, progressBar, metaLine, effortOf } = k
  const bar = current.tasks && progressOf(current.tasks)
  const linked = ctx.plan ? linkTask(ctx.plan, current.title) : undefined
  const persona = linked?.persona ?? inferPersona(current.title)
  const heading = linked ? descriptionOf(linked) : current.title
  const headerEffort = linked?.effort ?? effortOf(current)
  const headerMeta = [
    current.model,
    current.variant,
    linked && current.variant && effortOfVariant(current.variant) !== linked.effort && `planned ${linked.effort}`,
    formatElapsed(current.elapsedMs),
    current.currentTool,
  ]

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
        <Button key="back" label="Back" plain dimColor onPress={() => void ctx.back()} />
        <Box flexDirection="row" gap={2}>
          {current.tasks && bar && (
            <Button key="tasks" label={`Tasks ${bar.done}/${bar.total}`} plain dimColor onPress={() => void ctx.toggleTasks()} />
          )}
          {current.state === 'running' && <Button key={`stop-${current.id}`} label="Stop" onPress={() => void ctx.stop(current)} />}
        </Box>
      </Box>
      <Box flexDirection="row" alignItems="flex-start" columnGap={1}>
        {avatar(persona, headerEffort, current.state)}
        <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
          <Text bold wrap="truncate-end">{heading}</Text>
          {metaLine(headerEffort, headerMeta)}
        </Box>
      </Box>
      {bar && progressBar(`bar-${current.id}`, bar.percent, HEADER_INSET)}
      {bar && <Text dimColor wrap="truncate-end">{bar.label}</Text>}
    </Box>
  )
}

// The band shows the open agent's header on the terminal; the desktop app does not draw it.
export function renderBand($: any, e: any, ctx: PaneContext) {
  const current = ctx.statuses.find(a => a.id === ctx.openAgent)

  return current && e.surface === 'terminal' ? chatHeader(kit($, e), ctx, current) : undefined
}

export async function renderPane($: any, e: any, ctx: PaneContext) {
  const k = kit($, e)
  const { Box, Button, Markdown, Text, Svg, avatar, progressBar, metaLine, effortOf } = k
  // A render must not need the clock: derived from the last poll's elapsed time
  // instead, so every surface (and a test) draws with what it already holds.
  const now = ctx.statuses.reduce((latest, agent) => Math.max(latest, agent.startedAt + agent.elapsedMs), ctx.plan?.createdAt ?? 0)
  const { statuses, plan } = ctx
  const opened = ctx.openAgent
  const agents = statuses

  const warnings = (
    <Box flexDirection="column">
      {ctx.warning && <Text color="yellow">! {ctx.warning}</Text>}
      {ctx.stopError && <Text color="yellow">! {ctx.stopError}</Text>}
    </Box>
  )
  const stepLine = (step: ChatEntry) => (
    <Box flexDirection="row" columnGap={1}>
      <Text color={step.kind === 'error' ? 'error' : 'subtle'}>{step.kind === 'error' ? '✗' : '›'}</Text>
      <Box flexShrink={1}>
        <Text color={step.kind === 'error' ? 'error' : undefined} dimColor={step.kind !== 'error'} wrap="truncate-end">
          {[step.text, step.detail].filter(Boolean).join('  ')}
        </Text>
      </Box>
    </Box>
  )

  const current = agents.find(a => a.id === opened)
  if (current) {
    const { offset, bodyRows } = e.props.scroll
    const hasPrompt = ctx.prompts.includes(current.id)
    const isBandSurface = e.surface === 'terminal'
    // Nav, gap, title and meta, closing gap, then the bar and its label.
    const pinnedRows = 5 + (current.tasks && progressOf(current.tasks) ? 2 : 0)
    const chat = ctx.history.id === opened ? ctx.history : undefined
    const items = groupChat(chat?.entries ?? [])
    let detailBudget = DETAIL_BUDGET
    let didHideDetail = false
    const takeDetail = (text: string, limit: number) => {
      if (detailBudget <= 0) return ''
      const slice = text.slice(0, Math.min(limit, detailBudget))
      detailBudget -= slice.length

      return slice
    }
    const detail = (step: ChatEntry) => {
      const output = step.output ? takeDetail(step.output, OUTPUT_CHARS) : ''
      const diff = step.diff ? takeDetail(step.diff, DIFF_CHARS) : ''
      const outLines = output ? output.split('\n') : []
      const diffLines = diff ? diff.split('\n') : []
      if ((step.output && !output) || (step.diff && !diff)) didHideDetail = true

      return (
        <Box flexDirection="column" paddingLeft={2}>
          {outLines.slice(0, OUTPUT_LINES).map((line, index) => (
            <Text key={`out-${index}`} dimColor wrap="truncate-end">{line || ' '}</Text>
          ))}
          {outLines.length > OUTPUT_LINES && <Text dimColor>… {outLines.length - OUTPUT_LINES} more lines</Text>}
          {diffLines.slice(0, DIFF_LINES).map((line, index) => (
            <Text key={`diff-${index}`} color={diffColor(line)} dimColor={!diffColor(line)} wrap="truncate-end">{line || ' '}</Text>
          ))}
          {diffLines.length > DIFF_LINES && <Text dimColor>… {diffLines.length - DIFF_LINES} more diff lines</Text>}
        </Box>
      )
    }
    const turnLine = (item: Extract<ChatItem, { kind: 'turn' }>) => {
      const metrics = [
        `Turn ${item.index}`,
        item.durationMs !== undefined && formatShortElapsed(item.durationMs),
        item.tokens > 0 && `${formatTokens(item.tokens)} tok`,
        formatTurnCost(item.cost) || undefined,
      ].filter(Boolean)

      return <Text key={item.id} dimColor wrap="truncate-end">{`── ${metrics.join(' · ')} ──`}</Text>
    }

    return (
      <Box flexDirection="column">
        {/* Only the terminal draws the band; elsewhere a pinned header keeps its room here. */}
        {!isBandSurface && <Box height={pinnedRows} flexShrink={0} />}
        <Box flexDirection="column" gap={1} paddingTop={1}>
          {hasPrompt && <Text dimColor wrap="truncate-end">{`.opencode-monitor/${current.id}/prompt.txt`}</Text>}
          {/* In normal flow, so a long task just makes the page taller and is never cut. */}
          {ctx.chatView.isTasksOpen &&
            (current.tasks ?? []).map((task, n) => (
              <Box key={`task-${n}`} borderStyle="round" borderColor="subtle" paddingX={1}>
                <Text dimColor={task.status === 'completed'} wrap="wrap">{formatTask(task)}</Text>
              </Box>
            ))}
          {chat && chat.total > chat.entries.length && (
            <Text dimColor>Earlier activity hidden · showing the latest {chat.entries.length}</Text>
          )}
          {items.map((item, i) => {
            if (item.kind === 'turn') return turnLine(item)
            if (item.kind === 'reply') return <Markdown text={item.text} />
            if (item.kind === 'reasoning') {
              const isExpanded = ctx.chatView.expanded.includes(item.id)
              const text = isExpanded ? takeDetail(item.text, 4000) : ''

              return (
                <Box flexDirection="column" key={item.id}>
                  <Button
                    key={`thinking-${item.id}`}
                    plain
                    dimColor
                    label={isExpanded ? 'Thinking ↓' : 'Thinking →'}
                    onPress={() => void ctx.toggle(item.id)}
                  />
                  {isExpanded && <Text dimColor wrap="wrap">{text}</Text>}
                </Box>
              )
            }
            if (item.kind === 'prompt') {
              const isExpanded = ctx.chatView.expanded.includes(item.text)
              const clipped = clipText(item.text, e.props.bodyColumns, PROMPT_ROWS)
              // No theme key names the background, so a gradient overlay would show as a rectangle on one
              // theme; the last rows step down to dim and then subtle instead, on every surface.
              const lines = clipped.text.split('\n')
              const fade = (n: number) => (n === lines.length - 1 ? { dimColor: true, color: 'subtle' } : n === lines.length - 2 ? { dimColor: true } : {})

              return (
                <Box flexDirection="column">
                  {isExpanded || !clipped.isClipped ? (
                    <Text>{item.text}</Text>
                  ) : Svg ? (
                    // shortcut: ~7px per column and one row per 18px; a wide glyph run is clipped, not rewrapped.
                    <Box height={PROMPT_ROWS} flexShrink={0} overflow="hidden">
                    <Svg
                      source={fadedTextSvg(wrapRows(clipped.text, e.props.bodyColumns, PROMPT_ROWS), Math.max(80, e.props.bodyColumns * 7))}
                      alt={clipped.text}
                      width={Math.max(80, e.props.bodyColumns * 7)}
                      height={Math.min(PROMPT_ROWS, wrapRows(clipped.text, e.props.bodyColumns, PROMPT_ROWS).length) * 18}
                    />
                    </Box>
                  ) : (
                    lines.map((line, n) => <Text key={n} {...fade(n)}>{line || ' '}</Text>)
                  )}
                  {clipped.isClipped && (
                    <Button
                      key={`prompt-${i}`}
                      plain
                      dimColor
                      label={isExpanded ? 'Show less' : 'Show more'}
                      onPress={() => void ctx.toggle(item.text)}
                    />
                  )}
                </Box>
              )
            }
            const [only] = item.steps
            const hasDetail = item.steps.some(step => step.output || step.diff)
            const isExpanded = ctx.chatView.expanded.includes(item.id)
            if (item.steps.length === 1 && only && !hasDetail) return stepLine(only)
            const latest = item.steps.at(-1)
            const isLive = current.state === 'running' && i === items.length - 1

            return (
              <Box flexDirection="column">
                <Button
                  key={`steps-${i}`}
                  plain
                  dimColor
                  label={`${isExpanded ? '▾' : '▸'} ${item.label}`}
                  onPress={() => void ctx.toggle(item.id)}
                />
                {isExpanded
                  ? item.steps.map(step => (
                      <Box flexDirection="column" key={step.id ?? `${step.text}-${step.detail ?? ''}`}>
                        {stepLine(step)}
                        {(step.output || step.diff) && detail(step)}
                      </Box>
                    ))
                  : isLive && latest && stepLine(latest)}
                {isExpanded && didHideDetail && <Text dimColor>… more detail hidden</Text>}
              </Box>
            )
          })}
          {warnings}
        </Box>
        {!isBandSurface && (
          <Box key="chat-header" position="absolute" top={offset} left={0} right={0} height={pinnedRows} backgroundColor={HEADER_BACKGROUND}>
            {chatHeader(k, ctx, current)}
          </Box>
        )}
        {!ctx.isFollowing && (
          <Box key="jump" position="absolute" top={offset + bodyRows - 1} right={0}>
            <Button key="jump-latest" label="Jump to latest" onPress={() => void ctx.jump()} />
          </Box>
        )}
      </Box>
    )
  }

  // List rows stay compact: agent output (question, recent text) lives in the chat view.
  const agentRow = (agent: AgentStatus, narrow: boolean) => {
    const effort = effortOf(agent)
    const bar = agent.tasks && progressOf(agent.tasks)

    return (
      <Box key={`agent-${agent.id}`} flexDirection="row" alignItems="flex-start" columnGap={1} paddingX={1}>
        {avatar(inferPersona(agent.title), effort, agent.state)}
        <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
          <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" columnGap={2}>
            <Box flexDirection="row" flexGrow={1} flexShrink={1} minWidth={16} columnGap={1}>
              <Text bold wrap="truncate-end">{agent.title}</Text>
              <Text color={GLYPH_COLORS[agent.state]}>{GLYPHS[agent.state]}</Text>
            </Box>
            <Box flexDirection="row" gap={2}>
              <Button key={`open-${agent.id}`} label="Open" onPress={() => void ctx.openChat(agent.id)} />
              {agent.state === 'running' && (
                <Button key={`stop-${agent.id}`} label="Stop" onPress={() => void ctx.stop(agent)} />
              )}
            </Box>
          </Box>
          {metaLine(
            effort,
            [
              agent.state === 'asking' && 'asking',
              agent.model,
              agent.variant,
              formatElapsed(agent.elapsedMs),
              bar && `${bar.done}/${bar.total}`,
              agent.currentTool,
            ],
            narrow ? 'wrap' : 'truncate-end',
          )}
          {bar && progressBar(`bar-${agent.id}`, bar.percent, CARD_INSET)}
        </Box>
      </Box>
    )
  }

  const planPanel = () => {
    if (!plan) return undefined
    const stats = planStats(plan, statuses, now)
    const rows = planRows(plan, statuses)
    const unplanned = unplannedAgents(plan, statuses)
    const narrow = e.props.bodyColumns < 50
    const card = (key: string, label: string, value: string) => (
      <Box
        key={key}
        flexDirection="column"
        flexGrow={1}
        minWidth={10}
        paddingX={1}
        borderStyle="round"
        borderColor="subtle"
      >
        <Text dimColor>{label}</Text>
        <Text>{value}</Text>
      </Box>
    )
    const stateOf = (agent: AgentStatus | undefined) => (agent ? GLYPHS[agent.state] : '○')
    const early = (row: PlanRow) =>
      row.newest?.state === 'running'
        ? row.task.after.filter(id => !isSettled(rows.find(other => other.task.id === id)?.newest))
        : []

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" columnGap={2}>
          <Text bold wrap="truncate-end">{plan.title}</Text>
          <Box flexDirection="row" gap={2}>
            <Button
              key="plan-collapse"
              label={ctx.planView.isCollapsed ? 'Expand' : 'Collapse'}
              onPress={() => void ctx.togglePlan()}
            />
            <Button key="plan-clear" label="Clear" onPress={() => void ctx.clearPlan()} />
          </Box>
        </Box>
        {!ctx.planView.isCollapsed && (
          <Box flexDirection={narrow ? 'column' : 'row'} gap={1}>
            {card('stat-cost', 'Cost', formatCost(stats.cost))}
            {card('stat-tokens', 'Tokens', formatTokens(stats.tokens))}
            {card('stat-time', 'Time', formatClock(stats.elapsedMs))}
          </Box>
        )}
        {!ctx.planView.isCollapsed && (
          <Text dimColor>{`Planned · ${stats.total} · ${stats.done} done`}</Text>
        )}
        {!ctx.planView.isCollapsed &&
          rows.map(row => {
            const agent = row.newest
            const resolved = resolvedTask(row.task, ctx.effort)
            const state = stateOf(agent)
            const elapsed = agent ? formatElapsed(agent.elapsedMs) : 'planned'
            const earlyIds = early(row)
            const bar = agent?.tasks && progressOf(agent.tasks)
            const meta = [
              agent?.model ?? resolved.model,
              agent?.variant ?? (agent ? undefined : resolved.variant),
              bar && `${bar.done}/${bar.total}`,
              agent?.currentTool,
              agent?.variant && effortOfVariant(agent.variant) !== row.task.effort && `planned ${row.task.effort}`,
              row.task.after.length > 0 && !earlyIds.length && `after ${row.task.after.join(', ')}`,
            ]

            return (
              <Box key={`task-${row.task.id}`} flexDirection="row" alignItems="flex-start" columnGap={1} paddingX={1}>
                {avatar(row.task.persona, row.task.effort, agent?.state ?? 'planned')}
                <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
                <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" columnGap={2}>
                  <Box flexDirection="row" flexGrow={1} flexShrink={1} minWidth={16} columnGap={1}>
                    <Text bold dimColor={!agent} wrap="truncate-end">{descriptionOf(row.task)}</Text>
                    <Text color={agent ? GLYPH_COLORS[agent.state] : undefined} dimColor={!agent}>
                      {state}
                    </Text>
                    <Text dimColor wrap="truncate-end">{elapsed}</Text>
                    {row.agents.length > 1 && <Text dimColor>×{row.agents.length}</Text>}
                  </Box>
                  <Box flexDirection="row" gap={2}>
                    {agent && (
                      <Button key={`open-${agent.id}`} label="Open" onPress={() => void ctx.openChat(agent.id)} />
                    )}
                    {agent?.state === 'running' && (
                      <Button key={`stop-${agent.id}`} label="Stop" onPress={() => void ctx.stop(agent)} />
                    )}
                  </Box>
                </Box>
                {metaLine(row.task.effort, meta, narrow ? 'wrap' : 'truncate-end')}
                {earlyIds.length > 0 && <Text color="warning" wrap={narrow ? 'wrap' : 'truncate-end'}>{`! started before ${earlyIds.join(', ')}`}</Text>}
                {bar && progressBar(`bar-${agent!.id}`, bar.percent, CARD_INSET)}
                </Box>
              </Box>
            )
          })}
        {!ctx.planView.isCollapsed && unplanned.length > 0 && (
          <Box flexDirection="column" gap={1}>
            <Text dimColor>{`Unplanned · ${unplanned.length}`}</Text>
            {unplanned.map(agent => agentRow(agent, narrow))}
          </Box>
        )}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" justifyContent="space-between" gap={1}>
        <Text bold>opencode agents</Text>
        <Text dimColor>{formatCounts(agents)}</Text>
      </Box>
      {planPanel()}
      {!plan && agents.length === 0 && <Text dimColor>No agents yet</Text>}
      {!plan && agents.map(agent => agentRow(agent, e.props.bodyColumns < 50))}
      {warnings}
    </Box>
  )
}
