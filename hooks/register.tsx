import type { Register } from 'claude-code'

const PANE = 'opencode-agents'
const TITLE = 'opencode agents'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'opencode-agents',
      description: "Show this session's opencode subagents in a pane",
    })

    return next(e)
  })

  on('command.run', { command: 'opencode-agents' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'opencode agents pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Text bold>opencode agents</Text>
        <Text dimColor>No agents yet</Text>
      </Box>
    )
  })
}
