export type TrackedAgent = {
  id: string
  // Set while adopted from the database, until `callId`'s result names the real id.
  callId?: string
}

export type AgentState = 'running' | 'finished' | 'stopped' | 'unknown'

export type AgentStatus = {
  id: string
  title: string
  model: string
  state: AgentState
  startedAt: number
  elapsedMs: number
  currentTool?: string
  recent: string
  cost: number
}

// The engine has its own AgentStatus, which would shadow ours inside the block below.
export type OpencodeStatus = AgentStatus

declare module 'claude-code' {
  interface PluginState {
    'better-claude-opencode': {
      tracked: Shaped<TrackedAgent[]>
      statuses: Shaped<OpencodeStatus[]>
      warning: string
      stopError: string
    }
  }
}
