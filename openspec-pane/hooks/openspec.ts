export const CHANGES = 'openspec/changes'

type Entry = { name: string; kind: 'file' | 'dir' | 'other'; mtimeMs: number }

export type SpecFs = {
  list: (path: string) => Promise<readonly Entry[]>
  read: (path: string) => Promise<string>
}

export type Change = {
  id: string
  isArchived: boolean
  title: string | undefined
  done: number
  total: number
  mtimeMs: number
}

const TASK = /^\s*[-*]\s+\[([ xX])\]/gm

export const progressOf = (tasks: string) => {
  const marks = [...tasks.matchAll(TASK)].map(m => m[1])
  return { done: marks.filter(m => m !== ' ').length, total: marks.length }
}

export const titleOf = (proposal: string) =>
  proposal
    .split('\n')
    .find(line => line.startsWith('# '))
    ?.slice(2)
    .replace(/^(Change|Proposal):\s*/i, '')
    .trim()

const listOr = (fs: SpecFs, path: string) => fs.list(path).catch(() => [] as readonly Entry[])

const readOr = (fs: SpecFs, path: string) => fs.read(path).catch(() => '')

const newestIn = async (fs: SpecFs, dir: string) =>
  Math.max(0, ...(await listOr(fs, dir)).map(entry => entry.mtimeMs))

export const recentChanges = async (fs: SpecFs, count: number): Promise<Change[]> => {
  const dirs = async (path: string, isArchived: boolean) =>
    (await listOr(fs, path))
      .filter(entry => entry.kind === 'dir' && (isArchived || entry.name !== 'archive'))
      .map(entry => ({ path: `${path}/${entry.name}`, name: entry.name, isArchived }))

  const all = [...(await dirs(CHANGES, false)), ...(await dirs(`${CHANGES}/archive`, true))]
  const dated = await Promise.all(
    all.map(async dir => ({ ...dir, mtimeMs: await newestIn(fs, dir.path) })),
  )
  const recent = dated.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, Math.max(1, count))

  return Promise.all(
    recent.map(async dir => ({
      id: dir.isArchived ? dir.name.replace(/^\d{4}-\d{2}-\d{2}-/, '') : dir.name,
      isArchived: dir.isArchived,
      title: titleOf(await readOr(fs, `${dir.path}/proposal.md`)),
      ...progressOf(await readOr(fs, `${dir.path}/tasks.md`)),
      mtimeMs: dir.mtimeMs,
    })),
  )
}

export const ago = (ms: number) => {
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  if (min < 48 * 60) return `${Math.floor(min / 60)}h`
  return `${Math.floor(min / (24 * 60))}d`
}

export const bar = (done: number, total: number, width = 8) => {
  const full = total === 0 ? 0 : Math.round((done / total) * width)
  return `${'█'.repeat(full)}${'░'.repeat(width - full)}`
}
