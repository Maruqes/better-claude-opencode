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
