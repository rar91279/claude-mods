import { test, expect, mock } from 'claude-code/testing'

const PANE = {
  component: 'Pane',
  requestId: 'openspec',
  props: {
    title: 'OpenSpec',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('the pane says so when there is no openspec folder', async ($, on) => {
  mock.clock(on)
  on('fs.list', async (_$: any, e: any) => {
    throw new Error(`ENOENT ${e.path}`)
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'openspec-pane', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /No changes/ })).toBeDefined()
    await ui.unmount()
  }
})
