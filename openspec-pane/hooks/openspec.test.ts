import { test, expect } from 'claude-code/testing'

import { ago, archivedRowsLeft, barParts, pagesByHeight, plainInline, prettySpec, prettyTasks, checkTask, markdownPieces, commandFor, openTasksBySection, percentOf, missingWorkflows, openTasksOf, progressOf, recentChanges, stateOf, titleOf, type Change, type SpecFs } from './openspec'

const tree: Record<string, { mtimeMs?: number; text?: string; dir?: true }> = {
  'openspec/changes/add-auth': { dir: true },
  'openspec/changes/add-auth/proposal.md': { mtimeMs: 300, text: '# Change: Add auth\n\nWhy' },
  'openspec/changes/add-auth/tasks.md': { mtimeMs: 500, text: '- [x] a\n- [ ] b\n  - [X] c' },
  'openspec/changes/fix-typo': { dir: true },
  'openspec/changes/fix-typo/proposal.md': { mtimeMs: 100, text: 'no heading' },
  'openspec/changes/archive': { dir: true },
  'openspec/changes/archive/2026-09-01-old-thing': { dir: true },
  'openspec/changes/archive/2026-09-01-old-thing/tasks.md': { mtimeMs: 400, text: '- [x] done' },
  // Older than the one listed, yet counted as left open.
  'openspec/changes/archive/2026-08-01-half-done': { dir: true },
  'openspec/changes/archive/2026-08-01-half-done/tasks.md': { mtimeMs: 50, text: '- [x] a\n- [ ] b' },
}

const fs: SpecFs = {
  list: async path => {
    const children = Object.keys(tree).filter(
      key => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'),
    )
    if (children.length === 0 && !tree[path]) throw new Error(`missing ${path}`)
    return children.map(key => ({
      name: key.slice(path.length + 1),
      kind: tree[key]?.dir ? ('dir' as const) : ('file' as const),
      mtimeMs: tree[key]?.mtimeMs ?? 0,
    }))
  },
  read: async path => {
    const text = tree[path]?.text
    if (text === undefined) throw new Error(`missing ${path}`)
    return text
  },
}

test('counts checked and open tasks, nested ones too', () => {
  expect(progressOf('- [x] a\n- [ ] b\n  * [X] c\ntext [ ] not a task')).toEqual({ done: 2, total: 3, next: 'b' })
})

test('takes the first heading as the title, without a Change: prefix', () => {
  expect(titleOf('intro\n# Change: Add auth\n# Other')).toBe('Add auth')
  expect(titleOf('')).toBeUndefined()
})

test('falls back to the first sentence where the heading says nothing', () => {
  const why = '# Proposal\n\n## Why\n\n`billing_entry` is the record of **everything** sent. It is big.\n'
  expect(titleOf(why, 'billing-transactions')).toBe('billing_entry is the record of everything sent.')
  expect(titleOf('# Proposal: secure-provider-intake\n\n## Why\n\nThe webhooks are soft.', 'secure-provider-intake')).toBe(
    'The webhooks are soft.',
  )
  expect(titleOf('# Proposal: HTTP exchange log\n\n## Why\n\nText.', 'http-exchange-log')).toBe('HTTP exchange log')
})

test('names the first open task as the next one', () => {
  expect(progressOf('- [x] 1.1 done\n- [ ]   1.2 Wire it up \n- [ ] 1.3 later').next).toBe('1.2 Wire it up')
  expect(progressOf('- [x] all done').next).toBeUndefined()
})

test('lists every active change and the archived ones up to count, newest first', async () => {
  expect(await recentChanges(fs, 0, () => 1)).toEqual({
    active: [
      { id: 'add-auth', path: 'openspec/changes/add-auth', isArchived: false, title: 'Add auth', done: 2, total: 3, next: 'b', mtimeMs: 500 },
      { id: 'fix-typo', path: 'openspec/changes/fix-typo', isArchived: false, title: 'no heading', done: 0, total: 0, next: undefined, mtimeMs: 100 },
    ],
    archived: [
      { id: 'old-thing', path: 'openspec/changes/archive/2026-09-01-old-thing', isArchived: true, title: undefined, done: 1, total: 1, next: undefined, mtimeMs: 400 },
    ],
    archivedTotal: 2,
    archivedLeftOpen: 1,
    archivedPage: 0,
    archivedPages: 2,
  })
})

test('is empty where the project has no openspec folder', async () => {
  const none: SpecFs = {
    list: async () => {
      throw new Error('missing')
    },
    read: async () => '',
  }
  expect(await recentChanges(none, 0, () => 5)).toEqual({
    active: [],
    archived: [],
    archivedTotal: 0,
    archivedLeftOpen: 0,
    archivedPage: 0,
    archivedPages: 1,
  })
})

test('says how long ago', () => {
  expect(ago(30_000)).toBe('now')
  expect(ago(5 * 60_000)).toBe('5m')
  expect(ago(3 * 3_600_000)).toBe('3h')
  expect(ago(3 * 86_400_000)).toBe('3d')
})

test('lists the open tasks the archive dialog warns about, in order', () => {
  expect(openTasksOf('- [x] 1.1 done\n- [ ] 1.2 Wire it up\n  - [ ] 1.3 Test it\n- [X] 1.4')).toEqual([
    '1.2 Wire it up',
    '1.3 Test it',
  ])
  expect(openTasksOf('')).toEqual([])
})

test('an active change untouched for longer than staleDays counts as postponed', () => {
  const day = 86_400_000
  const change: Change = { id: 'x', path: 'p', isArchived: false, title: undefined, done: 0, total: 1, next: 'a', mtimeMs: 0 }
  expect(stateOf(change, 13 * day, 14)).toBe('active')
  expect(stateOf(change, 15 * day, 14)).toBe('postponed')
  expect(stateOf({ ...change, isArchived: true }, 0, 14)).toBe('archived')
})


test('runs a workflow by its skill, else its /opsx: command', () => {
  expect(commandFor('explore', ['openspec-explore', 'opsx:explore'])).toBe('openspec-explore')
  expect(commandFor('apply', ['opsx:apply'])).toBe('opsx:apply')
  expect(commandFor('archive', ['help'])).toBeUndefined()
})

test('names the workflows the session has in neither form', () => {
  expect(missingWorkflows(['openspec-explore', 'opsx:propose', 'opsx:apply', 'openspec-archive-change'])).toEqual([])
  expect(missingWorkflows(['openspec-explore', 'help'])).toEqual(['propose', 'apply', 'archive'])
})

test('fills the bar and reads 100% only when every task is done', () => {
  expect(barParts(5, 8)).toEqual(['█████', '░░░'])
  expect(barParts(0, 0)).toEqual(['', '░░░░░░░░'])
  expect(percentOf(5, 8)).toBe(62)
  expect(barParts(49, 50)).toEqual(['███████', '░'])
  expect(percentOf(49, 50)).toBe(98)
  expect(percentOf(50, 50)).toBe(100)
  expect(percentOf(0, 0)).toBe(0)
})

test('groups the open tasks under their section headings', () => {
  const tasks = [
    '# Tasks',
    '- [ ] 0.1 before any section',
    '## 1. Schema',
    '- [x] 1.1 done',
    '- [ ] 1.2 Settle the width',
    '      against production',
    '## 2. API',
    '- [x] 2.1 done',
    '### 2.2 Details',
    '  - [ ] 2.2.1 nested',
  ].join('\n')
  expect(openTasksBySection(tasks)).toEqual([
    { section: undefined, tasks: [{ line: 1, text: '0.1 before any section' }] },
    { section: '1. Schema', tasks: [{ line: 4, text: '1.2 Settle the width' }] },
    { section: '2.2 Details', tasks: [{ line: 9, text: '2.2.1 nested' }] },
  ])
  expect(openTasksBySection('- [x] all done')).toEqual([])
})

test('checks the task on its line, keeping the line endings', () => {
  expect(checkTask('# T\n- [x] a\n- [ ] b\n', 2, 'b')).toBe('# T\n- [x] a\n- [x] b\n')
  expect(checkTask('# T\r\n  * [ ]  2.4 Settle\r\n', 1, '2.4 Settle')).toBe('# T\r\n  * [x]  2.4 Settle\r\n')
})

test('refuses to check a line that is no longer that open task', () => {
  expect(checkTask('- [ ] b\n- [ ] c', 0, 'c')).toBeUndefined()
  expect(checkTask('- [x] b', 0, 'b')).toBeUndefined()
  expect(checkTask('- [ ] b', 5, 'b')).toBeUndefined()
})

test('pages through the archived changes, newest first, clamping a page past the end', async () => {
  const second = await recentChanges(fs, 1, () => 1)
  expect(second.archived.map(change => change.id)).toEqual(['half-done'])
  expect([second.archivedPage, second.archivedPages]).toEqual([1, 2])
  const beyond = await recentChanges(fs, 7, () => 1)
  expect(beyond.archived.map(change => change.id)).toEqual(['half-done'])
  expect(beyond.archivedPage).toBe(1)
  expect((await recentChanges(fs, 0, () => 8)).archived.map(change => change.id)).toEqual(['old-thing', 'half-done'])
})

test('cuts pages by row height, a tall row never split', () => {
  expect(pagesByHeight([1, 2, 1, 1, 2], 3)).toEqual([[0, 2], [2, 4], [4, 5]])
  expect(pagesByHeight([2, 2], 1)).toEqual([[0, 1], [1, 2]])
  expect(pagesByHeight([], 5)).toEqual([[0, 0]])
})

test('leaves the archive the rows the rest of the list does not take', () => {
  const change = (next?: string): Change => ({
    id: 'x', path: 'p', isArchived: false, title: undefined, done: 0, total: 1, next, mtimeMs: 0,
  })
  // 40 rows, wide: 1 margin + 4 card + 2 header + 3 active (one with a next task) + 3 archive + 2 paging = 15.
  expect(archivedRowsLeft(40, 120, [change('a'), change()])).toBe(25)
  // Narrow, the card's content wraps to two lines.
  expect(archivedRowsLeft(40, 80, [change('a'), change()])).toBe(24)
  expect(archivedRowsLeft(10, 120, [change('a'), change()])).toBe(3)
})

test('reshapes a spec: delta sections, requirements, scenarios and their steps', () => {
  const spec = [
    '## ADDED Requirements',
    '### Requirement: Bodies are read in time',
    'The service SHALL read it.',
    '#### Scenario: A trickled body',
    '- **GIVEN** a timeout of one second',
    '- **WHEN** a client trickles',
    '- **THEN** it is answered',
    '- **AND** nothing is billed',
    '- an ordinary item',
  ].join('\r\n')
  expect(prettySpec(spec).split('\n')).toEqual([
    '## ➕ Added requirements',
    '### 📋 Bodies are read in time',
    'The service SHALL read it.',
    '#### 🎬 A trickled body',
    '- 🔹 **Given** a timeout of one second',
    '- ⚡ **When** a client trickles',
    '- ✅ **Then** it is answered',
    '  - ➕ **And** nothing is billed',
    '- an ordinary item',
  ])
})

test('reshapes tasks: open ones bold behind ☐, done ones behind ✅', () => {
  expect(prettyTasks('## 1. Schema\n- [x] 1.1 done\n  - [ ] 1.2 open\nnot a task').split('\n')).toEqual([
    '## 1. Schema',
    '- ✅ 1.1 done',
    '  - ☐ **1.2 open**',
    'not a task',
  ])
})

test('takes inline Markdown out of a task for one-line display', () => {
  expect(plainInline("2.4 Settle `providerTarif`'s real width against the **production** database")).toBe(
    "2.4 Settle providerTarif's real width against the production database",
  )
  expect(plainInline('*Done*, see [the docs](a.adoc) and _this_; keep snake_case and 2 * 3')).toBe(
    'Done, see the docs and this; keep snake_case and 2 * 3',
  )
})

test('splits long Markdown into whole pieces, at blank lines, headings and fences, never in a fence', () => {
  expect(markdownPieces('short', 30)).toEqual(['short'])
  const doc = ['# One', 'aaaaaaaaaa', 'bbbbbbbbbb', '', '## Two', 'cccccccccc', '```', 'x', '', 'y', '```', 'dddddddddd'].join('\n')
  expect(markdownPieces(doc, 30)).toEqual([
    '# One\naaaaaaaaaa\nbbbbbbbbbb\n',
    '## Two\ncccccccccc',
    '```\nx\n\ny\n```\ndddddddddd',
  ])
  const long = markdownPieces('z'.repeat(70), 30)
  expect(long.every(piece => piece.length <= 30)).toBe(true)
  expect(long.join('')).toBe('z'.repeat(70))
})
