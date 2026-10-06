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

const noFiles = (on: any, isSetUp: boolean) => {
  on('fs.stat', async () => {
    if (!isSetUp) throw new Error('ENOENT')
    return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }
  })
  on('fs.list', async (_$: any, e: any) => {
    throw new Error(`ENOENT ${e.path}`)
  })
}

test('without an openspec folder the pane offers to set OpenSpec up', async ($, on) => {
  mock.clock(on)
  noFiles(on, false)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'openspec-pane', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /isn't set up/ })).toBeDefined()
    expect(await ui.find({ key: 'init' })).toBeDefined()
    await ui.unmount()
  }
})

test('set up but empty, the pane shows Explore, Propose and an empty table', async ($, on) => {
  mock.clock(on)
  noFiles(on, true)
  const ran: string[] = []
  on('command.run', async (_$: any, e: any) => {
    ran.push(e.command)
    return { text: '' }
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    ran.length = 0
    const ui = await $.ui.mount({ plugin: 'openspec-pane', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /No active changes/ })).toBeDefined()
    await ui.press({ key: 'explore' })
    await ui.press({ key: 'propose' })
    expect(ran).toEqual(['openspec-explore', 'openspec-propose'])
    await ui.unmount()
  }
})

test('Set up OpenSpec runs openspec init, then the pane shows the table', async ($, on) => {
  mock.clock(on)
  let isSetUp = false
  on('fs.stat', async () => {
    if (!isSetUp) throw new Error('ENOENT')
    return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }
  })
  on('fs.list', async (_$: any, e: any) => {
    throw new Error(`ENOENT ${e.path}`)
  })
  const ran: string[][] = []
  on('process.run', async (_$: any, e: any) => {
    ran.push([...e.argv])
    isSetUp = true
    return {
      value: { exitCode: 0, stdout: 'OpenSpec Setup Complete', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })
  const ui = await $.ui.mount({ plugin: 'openspec-pane', surface: 'terminal', ...PANE })
  await ui.press({ key: 'init' })
  expect(ran).toEqual([['openspec', 'init', '--tools', 'claude', '--no-animation', '--no-copilot-cloud']])
  expect(await ui.find({ type: 'Text', text: /No active changes/ })).toBeDefined()
  await ui.unmount()
})

test('workflows on disk that the session lacks ask for a restart; absent ones for an install', async ($, on) => {
  mock.clock(on)
  // explore as a skill, propose as an /opsx: command; apply and archive nowhere.
  const onDisk = ['openspec/changes', 'skills/openspec-explore/SKILL.md', 'commands/opsx/propose.md']
  on('fs.stat', async (_$: any, e: any) => {
    const path = e.path.replaceAll('\\', '/')
    if (onDisk.some(one => path.endsWith(one))) {
      return { value: { kind: path.endsWith('.md') ? 'file' : 'dir', size: 0, mtimeMs: 0, isLink: false } }
    }
    throw new Error(`ENOENT ${e.path}`)
  })
  on('fs.list', async (_$: any, e: any) => {
    throw new Error(`ENOENT ${e.path}`)
  })
  on('command.list', async () => ({ value: [] }))
  const ui = await $.ui.mount({ plugin: 'openspec-pane', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /Restart Claude Code/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /explore, propose are installed/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /not installed: apply, archive/ })).toBeDefined()
  expect(await ui.find({ key: 'explore' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /No active changes/ })).toBeUndefined()
  await ui.unmount()
})

test('with only /opsx: commands installed the pane warns about nothing and runs them', async ($, on) => {
  mock.clock(on)
  noFiles(on, true)
  const commands = ['opsx:explore', 'opsx:propose', 'opsx:apply', 'opsx:archive']
  on('command.list', async () => ({
    value: commands.map(name => ({ name, description: '', source: 'user' as const })),
  }))
  const ran: string[] = []
  on('command.run', async (_$: any, e: any) => {
    ran.push(e.command)
    return { text: '' }
  })
  const ui = await $.ui.mount({ plugin: 'openspec-pane', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /not installed|Restart/ })).toBeUndefined()
  await ui.press({ key: 'explore' })
  await ui.press({ key: 'propose' })
  expect(ran).toEqual(['opsx:explore', 'opsx:propose'])
  await ui.unmount()
})

test('Archive asks in the pane, Cancel goes back, and asking again works', async ($, on) => {
  mock.clock(on)
  on('fs.stat', async () => ({ value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }))
  on('fs.list', async (_$: any, e: any) => {
    const path = e.path.replaceAll('\\', '/')
    const entry = (name: string, kind: 'dir' | 'file') => ({ name, kind, size: 0, mtimeMs: 1, isLink: false })
    if (path.endsWith('openspec/changes')) return { value: [entry('add-auth', 'dir')] }
    if (path.endsWith('openspec/changes/add-auth')) return { value: [entry('tasks.md', 'file')] }
    throw new Error(`ENOENT ${e.path}`)
  })
  on('fs.read', async (_$: any, e: any) => {
    if (e.path.replaceAll('\\', '/').endsWith('add-auth/tasks.md')) return { value: '- [x] a\n- [ ] Wire it up' }
    throw new Error(`ENOENT ${e.path}`)
  })
  const ran: string[] = []
  on('command.run', async (_$: any, e: any) => {
    ran.push(`${e.command} ${e.args ?? ''}`.trim())
    return { text: '' }
  })
  const ui = await $.ui.mount({ plugin: 'openspec-pane', surface: 'terminal', ...PANE })
  for (let round = 0; round < 2; round++) {
    await ui.press({ key: 'archive:add-auth' })
    expect(await ui.find({ type: 'Text', text: /Archive add-auth\?/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Wire it up/ })).toBeDefined()
    await ui.press({ key: 'cancel' })
    expect(await ui.find({ type: 'Text', text: /Archive add-auth\?/ })).toBeUndefined()
  }
  expect(ran).toEqual([])
  await ui.press({ key: 'archive:add-auth' })
  await ui.press({ key: 'archive' })
  expect(ran).toEqual(['openspec-archive-change add-auth'])
  await ui.unmount()
})

test('in the Tasks tab, ☐ checks a left-open task of an archived change in its tasks.md', async ($, on) => {
  mock.clock(on)
  const archivedTasks = '## 2. Width\n- [x] 2.3 done\n- [ ] 2.4 Settle the width\n'
  const written: [string, string][] = []
  on('fs.stat', async () => ({ value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }))
  on('fs.list', async (_$: any, e: any) => {
    const path = e.path.split(String.fromCharCode(92)).join('/')
    const entry = (name: string, kind: 'dir' | 'file') => ({ name, kind, size: 0, mtimeMs: 1, isLink: false })
    if (path.endsWith('openspec/changes')) return { value: [entry('archive', 'dir')] }
    if (path.endsWith('openspec/changes/archive')) return { value: [entry('2026-09-24-tarif-management', 'dir')] }
    if (path.endsWith('tarif-management')) return { value: [entry('tasks.md', 'file')] }
    throw new Error(`ENOENT ${e.path}`)
  })
  on('fs.read', async (_$: any, e: any) => {
    if (e.path.endsWith('tasks.md')) return { value: archivedTasks }
    throw new Error(`ENOENT ${e.path}`)
  })
  on('fs.write', async (_$: any, e: any) => {
    // The engine hands the write an absolute path; keep the project-relative part.
    const path: string = e.path.split(String.fromCharCode(92)).join('/')
    written.push([path.slice(path.indexOf('openspec/changes/')), e.text])
    return { value: undefined }
  })
  const change = 'openspec/changes/archive/2026-09-24-tarif-management'
  const ui = await $.ui.mount({ plugin: 'openspec-pane', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /left open in/ })).toBeUndefined()
  await ui.press({ key: 'archived' })
  expect(await ui.find({ type: 'Text', text: /1 left open:/ })).toBeDefined()
  await ui.press({ key: `open:${change}` })
  await ui.press({ key: 'tab:tasks' })
  expect(await ui.find({ type: 'Text', text: /1 of 2 tasks open, though archived/ })).toBeDefined()
  await ui.press({ key: `check:${change}:2` })
  expect(written).toEqual([[`${change}/tasks.md`, '## 2. Width\n- [x] 2.3 done\n- [x] 2.4 Settle the width\n']])
  await ui.unmount()
})

test('the band above the prompt offers the pane while it is closed, and opens it', async ($, on) => {
  // With the pane open the band passes the drawing on; here the test is what lies beneath.
  on('ui.render', async () => ({ type: 'Box', props: {}, children: [] }) as any)
  mock.clock(on)
  noFiles(on, true)
  let isOpen = false
  on('ui.panes', async () => ({
    value: isOpen ? [{ id: 'openspec', title: 'OpenSpec', isShown: true, isFocused: false, isPlaced: true }] : [],
  }))
  const opened: string[] = []
  on('ui.open', async (_$: any, e: any) => {
    opened.push(e.id)
    isOpen = true
    return { value: { isPlaced: true } }
  })
  const band = {
    component: 'AbovePrompt',
    requestId: 'band',
    props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 120, scroll: { offset: 0, bodyRows: 3 }, view: {} },
  } as const
  const ui = await $.ui.mount({ plugin: 'openspec-pane', surface: 'terminal', ...band })
  expect(await ui.find({ key: 'open-pane' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /0 active/ })).toBeDefined()
  await ui.press({ key: 'open-pane' })
  expect(opened).toEqual(['openspec'])
  await ui.unmount()
  const again = await $.ui.mount({ plugin: 'openspec-pane', surface: 'terminal', ...band })
  expect(await again.find({ key: 'open-pane' })).toBeUndefined()
  await again.unmount()
})
