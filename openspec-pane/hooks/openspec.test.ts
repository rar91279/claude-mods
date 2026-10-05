import { test, expect } from 'claude-code/testing'

import { ago, progressOf, recentChanges, titleOf, type SpecFs } from './openspec'

const tree: Record<string, { mtimeMs?: number; text?: string; dir?: true }> = {
  'openspec/changes/add-auth': { dir: true },
  'openspec/changes/add-auth/proposal.md': { mtimeMs: 300, text: '# Change: Add auth\n\nWhy' },
  'openspec/changes/add-auth/tasks.md': { mtimeMs: 500, text: '- [x] a\n- [ ] b\n  - [X] c' },
  'openspec/changes/fix-typo': { dir: true },
  'openspec/changes/fix-typo/proposal.md': { mtimeMs: 100, text: 'no heading' },
  'openspec/changes/archive': { dir: true },
  'openspec/changes/archive/2026-09-01-old-thing': { dir: true },
  'openspec/changes/archive/2026-09-01-old-thing/tasks.md': { mtimeMs: 400, text: '- [x] done' },
}

const fs: SpecFs = {
  list: async path => {
    const children = Object.keys(tree).filter(
      key => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'),
    )
    if (children.length === 0 && !tree[path]) throw new Error(`missing ${path}`)
    return children.map(key => ({
      name: key.slice(path.length + 1),
      kind: tree[key].dir ? ('dir' as const) : ('file' as const),
      mtimeMs: tree[key].mtimeMs ?? 0,
    }))
  },
  read: async path => {
    const text = tree[path]?.text
    if (text === undefined) throw new Error(`missing ${path}`)
    return text
  },
}

test('counts checked and open tasks, nested ones too', () => {
  expect(progressOf('- [x] a\n- [ ] b\n  * [X] c\ntext [ ] not a task')).toEqual({ done: 2, total: 3 })
})

test('takes the first heading as the title, without a Change: prefix', () => {
  expect(titleOf('intro\n# Change: Add auth\n# Other')).toBe('Add auth')
  expect(titleOf('no heading')).toBeUndefined()
})

test('lists active and archived changes, newest first, up to count', async () => {
  expect(await recentChanges(fs, 2)).toEqual([
    { id: 'add-auth', isArchived: false, title: 'Add auth', done: 2, total: 3, mtimeMs: 500 },
    { id: 'old-thing', isArchived: true, title: undefined, done: 1, total: 1, mtimeMs: 400 },
  ])
})

test('is empty where the project has no openspec folder', async () => {
  const none: SpecFs = {
    list: async () => {
      throw new Error('missing')
    },
    read: async () => '',
  }
  expect(await recentChanges(none, 5)).toEqual([])
})

test('says how long ago', () => {
  expect(ago(30_000)).toBe('now')
  expect(ago(5 * 60_000)).toBe('5m')
  expect(ago(3 * 3_600_000)).toBe('3h')
  expect(ago(3 * 86_400_000)).toBe('3d')
})
