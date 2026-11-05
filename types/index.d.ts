// The pane keeps no state yet; later tasks add their keys here.
export type OpencodeState = {}

declare module 'claude-code' {
  interface PluginState {
    'better-claude-opencode': OpencodeState
  }
}
