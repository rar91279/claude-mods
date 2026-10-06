export const CHANGES = 'openspec/changes'

type Entry = { name: string; kind: 'file' | 'dir' | 'other'; mtimeMs: number }

export type SpecFs = {
  list: (path: string) => Promise<readonly Entry[]>
  read: (path: string) => Promise<string>
}

export type Change = {
  id: string
  /** The change folder, relative to the project. */
  path: string
  isArchived: boolean
  title: string | undefined
  done: number
  total: number
  next: string | undefined
  mtimeMs: number
}

export type Changes = {
  active: Change[]
  archived: Change[]
  archivedTotal: number
  /** How many archived changes, of all of them, were closed with tasks unchecked. */
  archivedLeftOpen: number
  /** The archived page shown, from 0, and how many pages there are (at least one). */
  archivedPage: number
  archivedPages: number
}

const TASK = /^\s*[-*]\s+\[([ xX])\][ \t]*(.*)$/gm

/** The text of every unchecked task in `tasks.md`, in order. */
export const openTasksOf = (tasks: string) =>
  [...tasks.matchAll(TASK)].filter(m => m[1] === ' ').map(m => m[2]?.trim() ?? '')

/** An unchecked task: its text, and its line in `tasks.md` (0-based) for ticking it off. */
export type OpenTask = { line: number; text: string }

export type OpenSection = { section: string | undefined; tasks: OpenTask[] }

const OPEN_TASK = /^(\s*[-*]\s+)\[ \]([ \t]*)(.*)$/

/**
 * The unchecked tasks of `tasks.md` under the heading each stands in, in order, so a left-over
 * task can be found again. Tasks before any `##` heading have no section.
 */
export const openTasksBySection = (tasks: string): OpenSection[] => {
  const sections: OpenSection[] = []
  let section: string | undefined
  tasks.split(/\r?\n/).forEach((line, index) => {
    const heading = /^#{2,}\s+(.*)$/.exec(line)
    if (heading) {
      section = heading[1]?.trim()
      return
    }
    const task = OPEN_TASK.exec(line)
    if (!task) return
    const open = { line: index, text: task[3]?.trim() ?? '' }
    const last = sections.at(-1)
    if (last !== undefined && last.section === section) last.tasks.push(open)
    else sections.push({ section, tasks: [open] })
  })
  return sections
}

/**
 * `tasks` with the task on `line` checked, or undefined when that line is no longer the open task
 * `text` (the file changed since it was read), so a stale press never ticks the wrong task.
 */
export const checkTask = (tasks: string, line: number, text: string) => {
  // Keep the file's own line endings: a checkout on Windows may have \r\n.
  const eol = tasks.includes('\r\n') ? '\r\n' : '\n'
  const lines = tasks.split(/\r?\n/)
  const task = OPEN_TASK.exec(lines[line] ?? '')
  if (!task || task[3]?.trim() !== text) return undefined
  lines[line] = `${task[1]}[x]${task[2]}${task[3]}`
  return lines.join(eol)
}

export const progressOf = (tasks: string) => {
  const marks = [...tasks.matchAll(TASK)]
  return {
    done: marks.filter(m => m[1] !== ' ').length,
    total: marks.length,
    next: openTasksOf(tasks)[0] || undefined,
  }
}

/**
 * What a proposal is about: its first `#` heading, without a `Change:` or `Proposal:` prefix. Where
 * that says nothing (`# Proposal` alone, or the change's own id) it is the first sentence of the
 * proposal's prose instead, its inline Markdown taken out.
 */
export const titleOf = (proposal: string, id?: string) => {
  const lines = proposal.split(/\r?\n/)
  const heading = lines
    .find(line => line.startsWith('# '))
    ?.slice(2)
    .replace(/^(Change|Proposal):?\s*/i, '')
    .trim()
  if (heading && heading.toLowerCase() !== 'proposal' && heading !== id) return heading
  const prose = lines.find(line => line.trim() !== '' && !/^\s*(#|<!--|[-*>|]\s|```)/.test(line))
  if (prose === undefined) return heading || undefined
  const sentence = /^(.+?[.!?])(\s|$)/.exec(plainInline(prose.trim()))
  return sentence?.[1] ?? plainInline(prose.trim())
}

const listOr = (fs: SpecFs, path: string) => fs.list(path).catch(() => [] as readonly Entry[])

const readOr = (fs: SpecFs, path: string) => fs.read(path).catch(() => '')

const newestIn = async (fs: SpecFs, dir: string) =>
  Math.max(0, ...(await listOr(fs, dir)).map(entry => entry.mtimeMs))

type Dir = { path: string; name: string; isArchived: boolean; mtimeMs: number }

const datedDirs = async (fs: SpecFs, path: string, isArchived: boolean): Promise<Dir[]> => {
  const dirs = (await listOr(fs, path)).filter(
    entry => entry.kind === 'dir' && (isArchived || entry.name !== 'archive'),
  )
  const dated = await Promise.all(
    dirs.map(async entry => {
      const dir = `${path}/${entry.name}`
      return { path: dir, name: entry.name, isArchived, mtimeMs: await newestIn(fs, dir) }
    }),
  )
  return dated.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

const describe = (fs: SpecFs, dirs: Dir[]): Promise<Change[]> =>
  Promise.all(
    dirs.map(async dir => {
      const id = dir.isArchived ? dir.name.replace(/^\d{4}-\d{2}-\d{2}-/, '') : dir.name
      return {
        id,
        path: dir.path,
        isArchived: dir.isArchived,
        title: titleOf(await readOr(fs, `${dir.path}/proposal.md`), id),
        ...progressOf(await readOr(fs, `${dir.path}/tasks.md`)),
        mtimeMs: dir.mtimeMs,
      }
    }),
  )

/**
 * The rows left for archived changes once the list's other rows are drawn in a pane `bodyRows`
 * tall: the top margin, the summary card (its content wraps to two lines below 100 columns), the
 * column header and its rule, the active rows (two with a next-task line), the archive's rule and
 * toggle, and the page buttons. At least three, so a short pane still pages.
 * ponytail: mirrors register.tsx's layout by hand; recount here when that layout changes.
 */
export const archivedRowsLeft = (bodyRows: number, bodyColumns: number, active: readonly Change[]) => {
  const card = 2 + (bodyColumns >= 100 ? 1 : 2) + 1
  const activeRows = active.length === 0 ? 1 : active.reduce((sum, change) => sum + (change.next === undefined ? 1 : 2), 0)
  const fixed = 1 + card + 2 + activeRows + 3 + 2
  return Math.max(3, bodyRows - fixed)
}

/**
 * Cuts rows of the given heights into pages of at most `budget` rows each, in order, as
 * `[start, end)` ranges; a row taller than the budget gets a page of its own. Never empty.
 */
export const pagesByHeight = (heights: readonly number[], budget: number): [number, number][] => {
  const pages: [number, number][] = []
  let start = 0
  let used = 0
  heights.forEach((height, index) => {
    if (index > start && used + height > budget) {
      pages.push([start, index])
      start = index
      used = 0
    }
    used += height
  })
  pages.push([start, heights.length])
  return pages
}

/**
 * Every active change, and one page of archived ones (page 0 the most recently touched) that fits
 * in the rows `archivedRows` leaves them once the active changes are known: an archived row takes
 * two when it carries a "left open" line. Each list is newest first by the newest file directly
 * inside the folder. A page past the end shows the last one, and `archivedPage` says which was
 * shown. Reads every archived tasks.md, both to count the ones left open and to know each row's
 * height before cutting the pages.
 */
export const recentChanges = async (
  fs: SpecFs,
  archivedPage: number,
  archivedRows: (active: readonly Change[]) => number,
): Promise<Changes> => {
  const active = await describe(fs, await datedDirs(fs, CHANGES, false))
  const archived = await datedDirs(fs, `${CHANGES}/archive`, true)
  // How many tasks each archived change left unchecked.
  const leftOpen = await Promise.all(
    archived.map(async dir => openTasksOf(await readOr(fs, `${dir.path}/tasks.md`)).length),
  )
  const pages = pagesByHeight(
    leftOpen.map(open => (open > 0 ? 2 : 1)),
    archivedRows(active),
  )
  const page = Math.min(Math.max(0, archivedPage), pages.length - 1)
  const [start, end] = pages[page] ?? [0, 0]

  return {
    active,
    archived: await describe(fs, archived.slice(start, end)),
    archivedTotal: archived.length,
    archivedLeftOpen: leftOpen.filter(open => open > 0).length,
    archivedPage: page,
    archivedPages: pages.length,
  }
}

export type ChangeState = 'active' | 'postponed' | 'archived'

/** Postponed is not an OpenSpec state: an active change nobody has touched for `staleDays`. */
export const stateOf = (change: Change, now: number, staleDays: number): ChangeState => {
  if (change.isArchived) return 'archived'
  return now - change.mtimeMs > staleDays * 86_400_000 ? 'postponed' : 'active'
}

export const ago = (ms: number) => {
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  if (min < 48 * 60) return `${Math.floor(min / 60)}h`
  return `${Math.floor(min / (24 * 60))}d`
}

/** A progress bar's filled and empty halves, drawn in different colours. */
// Both round down, so a bar is full and a share reads 100% only when every task is checked:
// 49 of 50 is 98%, not a finished-looking 100%.
export const barParts = (done: number, total: number, width = 8): [string, string] => {
  const full = total === 0 ? 0 : Math.floor((done / total) * width)
  return ['█'.repeat(full), '░'.repeat(width - full)]
}

export const percentOf = (done: number, total: number) => (total === 0 ? 0 : Math.floor((done / total) * 100))

// One Markdown element draws at most 10000 characters.
const MARKDOWN_MAX = 10_000

/**
 * `text` in pieces of at most `max` characters, drawn one Markdown element each, so a long file
 * shows whole. A piece ends where the Markdown allows it, before a blank line or a heading outside
 * a ``` fence; only where it has no such place does it end at any line. A single line too long for
 * a piece is cut into pieces of its own.
 */
export const markdownPieces = (text: string, max = MARKDOWN_MAX): string[] => {
  if (text.length <= max) return [text]
  const pieces: string[] = []
  let piece: string[] = []
  let size = 0
  let safe = 0 // how many lines of `piece` may end it at a good place
  let inFence = false
  for (const whole of text.split(/\r?\n/)) {
    const parts = whole.length < max ? [whole] : (whole.match(new RegExp(`[^]{1,${max - 1}}`, 'g')) ?? [''])
    for (const line of parts) {
      if (!inFence && (line.trim() === '' || /^#{1,6}\s/.test(line) || /^\s*```/.test(line))) safe = piece.length
      while (piece.length > 0 && size + line.length + 1 > max) {
        const cut = safe > 0 ? safe : piece.length
        pieces.push(piece.slice(0, cut).join('\n'))
        piece = piece.slice(cut)
        size = piece.reduce((sum, kept) => sum + kept.length + 1, 0)
        safe = 0
      }
      piece.push(line)
      size += line.length + 1
    }
    if (/^\s*```/.test(whole)) inFence = !inFence
  }
  if (piece.length > 0) pieces.push(piece.join('\n'))
  return pieces
}

export type Workflow = 'explore' | 'propose' | 'apply' | 'archive'

/**
 * The OpenSpec workflows the pane's buttons run, each in the two forms OpenSpec installs: a skill
 * (`openspec-explore`) or, with the CLI's `delivery: commands`, an `/opsx:` command alone.
 */
export const WORKFLOWS: Record<Workflow, { skill: string; command: string }> = {
  explore: { skill: 'openspec-explore', command: 'opsx:explore' },
  propose: { skill: 'openspec-propose', command: 'opsx:propose' },
  apply: { skill: 'openspec-apply-change', command: 'opsx:apply' },
  archive: { skill: 'openspec-archive-change', command: 'opsx:archive' },
}

const ALL_WORKFLOWS = Object.keys(WORKFLOWS) as Workflow[]

/** What to run a workflow by: its skill, else its command; undefined when the session has neither. */
export const commandFor = (workflow: Workflow, available: readonly string[]) => {
  const { skill, command } = WORKFLOWS[workflow]
  if (available.includes(skill)) return skill
  return available.includes(command) ? command : undefined
}

/** The workflows the session can run in neither form. */
export const missingWorkflows = (available: readonly string[]) =>
  ALL_WORKFLOWS.filter(workflow => commandFor(workflow, available) === undefined)

/** Where a workflow's files sit in the project, in either form. */
export const filesOf = (workflow: Workflow) => [
  `.claude/skills/${WORKFLOWS[workflow].skill}/SKILL.md`,
  `.claude/commands/opsx/${workflow}.md`,
]

// OpenSpec's delta sections, as headings that read at a glance.
const DELTAS: Record<string, string> = {
  ADDED: '➕ Added requirements',
  MODIFIED: '✏️ Modified requirements',
  REMOVED: '➖ Removed requirements',
  RENAMED: '🔀 Renamed requirements',
}

// A scenario's steps; an AND continues the step before it, so it is drawn nested under it.
const STEPS: Record<string, string> = {
  GIVEN: '🔹 **Given**',
  WHEN: '⚡ **When**',
  THEN: '✅ **Then**',
}

/**
 * An OpenSpec spec reshaped for reading before it is drawn as Markdown: delta sections, 📋
 * requirements and 🎬 scenarios as headings without their keyword, and Given/When/Then steps
 * with icons, an And nested under the step it continues. Anything else passes through unchanged.
 */
export const prettySpec = (spec: string) =>
  spec
    .split(/\r?\n/)
    .map(line => {
      const delta = /^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements\s*$/i.exec(line)
      if (delta) return `## ${DELTAS[delta[1]?.toUpperCase() ?? ''] ?? line}`
      const requirement = /^###\s+Requirement:\s*(.*)$/.exec(line)
      if (requirement) return `### 📋 ${requirement[1]}`
      const scenario = /^####\s+Scenario:\s*(.*)$/.exec(line)
      if (scenario) return `#### 🎬 ${scenario[1]}`
      const step = /^(\s*)[-*]\s+\*\*(GIVEN|WHEN|THEN|AND)\*\*\s*(.*)$/.exec(line)
      if (!step) return line
      const [, indent = '', keyword = '', rest = ''] = step
      return keyword === 'AND' ? `${indent}  - ➕ **And** ${rest}` : `${indent}- ${STEPS[keyword]} ${rest}`
    })
    .join('\n')

/** A tasks.md reshaped for reading: open tasks as a bold ☐, done ones as ✅. Else unchanged. */
export const prettyTasks = (tasks: string) =>
  tasks
    .split(/\r?\n/)
    .map(line => {
      const task = /^(\s*[-*]\s+)\[([ xX])\][ \t]*(.*)$/.exec(line)
      if (!task) return line
      const [, bullet = '- ', mark, text = ''] = task
      return mark === ' ' ? `${bullet}☐ **${text}**` : `${bullet}✅ ${text}`
    })
    .join('\n')

/**
 * A task's inline Markdown taken out, for the one-line views that draw it as plain text so it can
 * be cut at the edge: `code`, **bold**, *italic*, _italic_ and [links](…) keep only their words.
 * The task as written stays the one ticked off.
 */
export const plainInline = (text: string) =>
  text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?!\w)/g, '$1$2')
    .replace(/(^|\W)_(?!\s)(.+?)_(?!\w)/g, '$1$2')

/** The archive's warning: how many archived changes were closed with tasks open, "⚠️ 4 unfinished". */
export const leftOpenNote = (changes: number) => `⚠️ ${changes} unfinished`
