export type TrackedAgent = {
  id: string
  // Set while adopted from the database, until `callId`'s result names the real id.
  callId?: string
}

export type Task = { content: string; status: string }

export type Effort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type Persona = 'scout' | 'builder' | 'tester' | 'reviewer' | 'general'

export type PlanTask = {
  id: number
  title: string
  persona: Persona
  effort: Effort
  after: number[]
  model?: string
}

export type Plan = {
  title: string
  createdAt: number
  tasks: PlanTask[]
}

export type PlanView = { isCollapsed: boolean }

// Same shape as ChatEntry in hooks/summary.ts: the contract must be self-contained.
export type ChatEntry = {
  kind: 'prompt' | 'reply' | 'tool' | 'error' | 'reasoning'
  text: string
  detail?: string
  id?: string
  messageId?: string
  output?: string
  diff?: string
  tokens?: number
  cost?: number
  timeCreated?: number
  timeCompleted?: number
}

// The log of the one open agent; `id` says whose, as a poll can land after a switch.
export type AgentHistory = { id: string; entries: ChatEntry[]; total: number }

export type ChatView = { isTasksOpen: boolean; expanded: string[] }

export type AgentState = 'running' | 'asking' | 'finished' | 'stopped' | 'unknown'

export type AgentStatus = {
  id: string
  title: string
  model: string
  // The opencode model variant that actually ran; absent for `default`.
  variant?: string
  state: AgentState
  startedAt: number
  elapsedMs: number
  currentTool?: string
  recent: string
  cost: number
  // Input + output + reasoning tokens, without cache reads or writes.
  tokens: number
  // The agent's opencode todos, in order; absent when it has none.
  tasks?: Task[]
  // Set while `state` is `asking`: what the agent wants to know.
  question?: string
}

// The engine has its own AgentStatus, which would shadow ours inside the block below.
export type OpencodeStatus = AgentStatus

declare module 'claude-code' {
  interface PluginState {
    'opencode-agent-monitor': {
      tracked: Shaped<TrackedAgent[]>
      statuses: Shaped<OpencodeStatus[]>
      // Agents whose result Claude already received, so they get no wake.
      delivered: Shaped<string[]>
      history: Shaped<AgentHistory>
      // Agents whose prompt.txt has been written.
      prompts: Shaped<string[]>
      openAgent: string
      // What the person unfolded in the open chat; `isTasksOpen` is the header's checklist.
      chatView: Shaped<ChatView>
      // The shared plan Claude registered; `planView` keeps its collapsed state.
      plan: Shaped<Plan | null>
      planView: Shaped<PlanView>
      warning: string
      stopError: string
    }
  }
}
