import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput } from 'claude-code'

import type { Tab, Viewing } from '../types'
import {
  CHANGES,
  WORKFLOWS,
  ago,
  archivedRowsLeft,
  barParts,
  checkTask,
  markdownPieces,
  commandFor,
  filesOf,
  missingWorkflows,
  openTasksBySection,
  openTasksOf,
  percentOf,
  plainInline,
  prettySpec,
  prettyTasks,
  progressOf,
  recentChanges,
  stateOf,
  type Change,
  type ChangeState,
  type OpenTask,
  type Workflow,
} from './openspec'

const PANE = 'openspec'
const TITLE = 'OpenSpec'
// Panes earlier versions opened, closed on load (see session.start).
const RETIRED_PANES = ['openspec-archive', 'openspec-change'] as const

const TABS: readonly { tab: Tab; label: string; file?: string }[] = [
  { tab: 'proposal', label: '📄 Proposal', file: 'proposal.md' },
  { tab: 'design', label: '📐 Design', file: 'design.md' },
  { tab: 'tasks', label: '✅ Tasks', file: 'tasks.md' },
  { tab: 'specs', label: '📚 Specs' },
]
// Open tasks the archive dialog lists before "… and N more".
const SHOWN_TASKS = 5

const ICON: Record<ChangeState, string> = { active: '🟢', postponed: '⏸️', archived: '📦' }

// Column widths in cells; the change id takes what is left. Emoji are two cells.
const PROGRESS = 13
const WHEN = 4
const ACTIONS = 13
// The pane's inner margin, in cells.
const PAD = 1
// A row lights up under the pointer.
const ROW_HOVER = '#2d313a'
// The title column only shows when the pane is at least this wide.
const WITH_TITLE = 90

/**
 * The name and title columns' widths in a row `inner` cells wide, beside the fixed Progress, Age
 * and actions columns and their gaps: the name as wide as the longest id shown plus its icon (at
 * most 45% of what is free), the title the rest. Without a title column the name takes it all.
 */
const columnWidths = (inner: number, hasTitle: boolean, ids: readonly string[]) => {
  const free = Math.max(10, inner - PROGRESS - WHEN - ACTIONS - (hasTitle ? 4 : 3))
  if (!hasTitle) return { nameWidth: free, titleWidth: 0 }
  const nameWidth = Math.min(Math.max(8, ...ids.map(id => id.length)) + 3, Math.floor(free * 0.45))
  return { nameWidth, titleWidth: free - nameWidth }
}

/** `text` cut to `width` cells with an ellipsis; an emoji counts two, a variation selector none. */
const fit = (text: string, width: number) => {
  const cellsOf = (char: string) => (/\p{Extended_Pictographic}/u.test(char) ? 2 : /[️‍]/.test(char) ? 0 : 1)
  const chars = [...text]
  if (chars.reduce((sum, char) => sum + cellsOf(char), 0) <= width) return text
  let out = ''
  let used = 0
  for (const char of chars) {
    if (used + cellsOf(char) > width - 1) break
    used += cellsOf(char)
    out += char
  }
  return `${out}…`
}

const showArchived = atom({ plugin: 'openspec-pane', key: 'showArchived' } as const, false)
const archivedPage = atom({ plugin: 'openspec-pane', key: 'archivedPage' } as const, 0)
const archiving = atom({ plugin: 'openspec-pane', key: 'archiving' } as const, null)
const viewing = atom({ plugin: 'openspec-pane', key: 'viewing' } as const, null as Viewing)
const tab = atom({ plugin: 'openspec-pane', key: 'tab' } as const, 'proposal' as Tab)
const spec = atom({ plugin: 'openspec-pane', key: 'spec' } as const, null as string | null)
const settingUp = atom({ plugin: 'openspec-pane', key: 'settingUp' } as const, false)

const runCommand = ($: EngineInterface, command: string, args?: string) => {
  $.command.run({ command, args }).catch((error: unknown) => $.ui.toast(`/${command}: ${String(error)}`))
}

const availableCommands = ($: EngineInterface) =>
  $.command.list().then(
    commands => commands.map(command => command.name),
    () => undefined,
  )

// Runs a workflow by whichever form the session has, its skill when it cannot tell.
const runWorkflow = async ($: EngineInterface, workflow: Workflow, args?: string) => {
  const available = (await availableCommands($)) ?? []
  runCommand($, commandFor(workflow, available) ?? WORKFLOWS[workflow].skill, args)
}

// Archive moves the folder and syncs the specs, so it asks first: the OpenSpec pane shows the
// question in place of the list or the change until it is answered. (A pane of its own showed a
// stale drawing when opened again, as the detail pane did.)
const confirmArchive = ($: EngineInterface, id: string) => void update($, archiving, () => id)

// Ticks a task off in the change's tasks.md, then redraws. A file that changed since it was drawn
// is left alone (checkTask refuses), so a stale press never ticks the wrong line.
const tickTask = async ($: EngineInterface, path: string, task: OpenTask) => {
  const file = `${path}/tasks.md`
  try {
    const text = await $.fs.read(file)
    const ticked = typeof text === 'string' ? checkTask(text, task.line, task.text) : undefined
    if (ticked === undefined) $.ui.toast('tasks.md changed since it was shown; nothing ticked, look again.')
    else await $.fs.write(file, ticked)
  } catch (error: unknown) {
    $.ui.toast(`Could not tick the task in ${file}: ${String(error)}`)
  }
  $.ui.invalidate('ui.render')
}

const drawArchive = async ($: EngineInterface, e: RenderInput, id: string) => {
  const { Box, Text, Button } = $.ui.resolve(e)
  const open = openTasksOf(await $.fs.read(`${CHANGES}/${id}/tasks.md`).catch(() => ''))
  // Cancel goes back to where Archive was pressed; Archive to the list, the change being gone.
  const cancel = () => void update($, archiving, () => null)
  const confirm = async () => {
    await update($, viewing, () => null)
    await update($, archiving, () => null)
    await runWorkflow($, 'archive', id)
  }

  return (
    <Box flexDirection="column" paddingX={PAD} paddingTop={1}>
      <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={2} paddingY={1}>
        <Text bold color="yellow">{`📦 Archive ${id}?`}</Text>
        <Text dimColor>{`It moves to ${CHANGES}/archive/ and its specs are synced.`}</Text>
        {open.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="yellow">{`${open.length} task${open.length === 1 ? ' is' : 's are'} still open:`}</Text>
            {open.slice(0, SHOWN_TASKS).map((task, index) => (
              <Text key={`task:${index}`} dimColor wrap="truncate-end">{`  ☐ ${plainInline(task)}`}</Text>
            ))}
            {open.length > SHOWN_TASKS && <Text dimColor>{`  … and ${open.length - SHOWN_TASKS} more`}</Text>}
          </Box>
        )}
        <Box marginTop={1} columnGap={1}>
          <Button key="cancel" hotkey="c" autoFocus onPress={cancel}>
            ✖️ Cancel
          </Button>
          <Button key="archive" variant="primary" onPress={confirm}>
            📦 Archive
          </Button>
        </Box>
      </Box>
    </Box>
  )
}

const touchesSpecs = (input: unknown) => JSON.stringify(input).includes('openspec')

// OpenSpec is set up where its changes folder exists.
const isSetUp = ($: EngineInterface) =>
  $.fs.stat(CHANGES).then(
    stat => stat.kind === 'dir',
    () => false,
  )

const INIT = ['openspec', 'init', '--tools', 'claude', '--no-animation', '--no-copilot-cloud'] as const

// Runs `openspec init` in the project, then draws the pane again. `$.process.run` takes no shell, so
// where `openspec` cannot start as named (npm's `openspec.cmd` on Windows) it goes through cmd.
const setUpOpenSpec = async ($: EngineInterface) => {
  await update($, settingUp, () => true)
  try {
    const init = { timeoutMs: 120_000 }
    const result = await $.process.run(INIT, init).catch(() => $.process.run(['cmd', '/c', ...INIT], init))
    if (result.exitCode !== 0) {
      const reason = (result.stderr || result.stdout).trim().split('\n').pop() ?? ''
      $.ui.toast(`openspec init failed (exit ${result.exitCode}): ${reason}`)
    }
  } catch (error: unknown) {
    $.ui.toast(`openspec init could not run; is the OpenSpec CLI installed? ${String(error)}`)
  } finally {
    await update($, settingUp, () => false)
    $.ui.invalidate('ui.render')
  }
}

// A change's documents, drawn in the OpenSpec pane in place of the list until ← OpenSpec is pressed.
const drawDetail = async ($: EngineInterface, e: RenderInput, change: NonNullable<Viewing>) => {
  const { Box, Text, Button, Markdown } = $.ui.resolve(e)
  const current = await read($, tab)
  const fileText = (file: string) => $.fs.read(`${change.path}/${file}`).catch(() => undefined)
  const back = () => void update($, viewing, () => null)

  // Apply and Archive as in the list: only on an active change, Apply only while tasks are open,
  // and whichever is the next step highlighted. Apply goes back to the list first.
  const isArchived = change.path.startsWith(`${CHANGES}/archive/`)
  const tasksText = (await fileText('tasks.md')) ?? ''
  const openTasks = openTasksOf(tasksText).length
  const isDone = openTasks === 0 && progressOf(tasksText).total > 0
  const apply = () => {
    back()
    void runWorkflow($, 'apply', change.id)
  }
  // Archive keeps the change open behind the question, so Cancel comes back to it.
  const archive = () => confirmArchive($, change.id)

  // A card like the list's summary: where you are and the next steps on top, the tabs below.
  const header = (
    <Box columnGap={1} flexWrap="wrap" justifyContent="space-between">
      <Box columnGap={1}>
        <Button key="back" hotkey="b" plain dimColor onPress={back}>
          ← OpenSpec
        </Button>
        <Text dimColor>/</Text>
        <Text bold color="cyan">
          {change.id}
        </Text>
      </Box>
      <Box columnGap={1}>
        {!isArchived && openTasks > 0 && (
          <Button key="detail-apply" hotkey="a" variant="primary" onPress={apply}>
            🚀 Apply
          </Button>
        )}
        {!isArchived && (
          <Button
            key="detail-archive"
            hotkey="x"
            variant={isDone ? 'primary' : undefined}
            dimColor={!isDone}
            onPress={archive}
          >
            📦 Archive
          </Button>
        )}
      </Box>
    </Box>
  )

  const tabBar = (
    <Box columnGap={1} marginTop={1} flexWrap="wrap">
      {TABS.map((one, index) => (
        <Button
          key={`tab:${one.tab}`}
          hotkey={String(index + 1)}
          variant={one.tab === current ? 'primary' : undefined}
          dimColor={one.tab !== current}
          onPress={() => void update($, tab, () => one.tab)}
        >
          {one.label}
        </Button>
      ))}
    </Box>
  )

  const body = async () => {
    const file = TABS.find(one => one.tab === current)?.file
    if (file !== undefined) {
      const text = await fileText(file)
      if (text === undefined) return <Text dimColor>{`This change has no ${file}.`}</Text>
      const doc = (
        <Box flexDirection="column">
          {markdownPieces(current === "tasks" ? prettyTasks(text) : text).map((piece, index) => (
            <Markdown key={`doc:${current}:${index}`} text={piece} />
          ))}
        </Box>
      )
      if (current !== 'tasks') return doc

      // A long tasks.md hides the one unchecked box: the open tasks come first, by section.
      const open = openTasksBySection(text)
      const openCount = open.reduce((sum, one) => sum + one.tasks.length, 0)
      const total = progressOf(text).total
      return (
        <Box flexDirection="column">
          {openCount === 0 ? (
            <Box marginBottom={1}>
              <Text color="green">{total > 0 ? `✅ All ${total} tasks done.` : 'No tasks listed.'}</Text>
            </Box>
          ) : (
            <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={2} marginBottom={1}>
              <Text bold color="yellow">{`⚠️ ${openCount} of ${total} task${total === 1 ? '' : 's'} open${isArchived ? ', though archived' : ''}`}</Text>
              <Text dimColor>Press ☐ to mark a task done in tasks.md.</Text>
              {open.map((one, index) => (
                <Box key={`open:${index}`} flexDirection="column" marginTop={1}>
                  {one.section !== undefined && <Text dimColor bold>{one.section}</Text>}
                  {one.tasks.map(task => (
                    <Box key={`task:${task.line}`} columnGap={1}>
                      <Button key={`check:${change.path}:${task.line}`} plain onPress={() => tickTask($, change.path, task)}>
                        ☐
                      </Button>
                      <Text wrap="truncate-end">{plainInline(task.text)}</Text>
                    </Box>
                  ))}
                </Box>
              ))}
            </Box>
          )}
          {doc}
        </Box>
      )
    }

    const capabilities = (await $.fs.list(`${change.path}/specs`).catch(() => []))
      .filter(entry => entry.kind === 'dir')
      .map(entry => entry.name)
      .sort()
    if (capabilities.length === 0) return <Text dimColor>This change has no specs.</Text>

    const chosen = await read($, spec)
    const shown = chosen !== null && capabilities.includes(chosen) ? chosen : capabilities[0]!
    const text = await fileText(`specs/${shown}/spec.md`)

    return (
      <Box flexDirection="column">
        <Box columnGap={1} flexWrap="wrap" marginBottom={1}>
          {capabilities.map(name => (
            <Button
              key={`spec:${name}`}
              plain
              dimColor={name !== shown}
              onPress={() => void update($, spec, () => name)}
            >
              {name === shown ? `▸ ${name}` : name}
            </Button>
          ))}
        </Box>
        {text === undefined ? (
          <Text dimColor>{`No spec.md in specs/${shown}/.`}</Text>
        ) : (
          <Box flexDirection="column">
            {markdownPieces(prettySpec(text)).map((piece, index) => (
              <Markdown key={`spec-doc:${shown}:${index}`} text={piece} />
            ))}
          </Box>
        )}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" paddingX={PAD} paddingTop={1}>
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" borderDimColor paddingX={2} marginBottom={1}>
        {header}
        {tabBar}
      </Box>
      <Box paddingX={2}>{await body()}</Box>
    </Box>
  )
}

export const register: Register = (on, options) => {
  const staleDays = typeof options.staleDays === 'number' ? options.staleDays : 14

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'openspec',
      description: 'Show the OpenSpec changes in a pane',
    })
    if (await $.fs.exists(CHANGES)) void $.ui.open({ id: PANE, title: TITLE })
    // Earlier versions opened the detail and the archive question as panes of their own; a reload
    // leaves those open, so put them away. Closing an id that is not open does nothing.
    for (const id of RETIRED_PANES) void $.ui.close({ id }).catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'openspec' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'OpenSpec pane opened.' }
  })

  on('tool.call', { tool: ['Write', 'Edit', 'Bash', 'PowerShell'] }, async ($, e, next) => {
    const ran = await next(e)
    if (touchesSpecs(e)) $.ui.invalidate('ui.render')

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const toArchive = await read($, archiving)
    if (toArchive !== null) return drawArchive($, e, toArchive)

    const viewed = await read($, viewing)
    if (viewed !== null) return drawDetail($, e, viewed)

    const { Box, Text, Button } = $.ui.resolve(e)

    if (!(await isSetUp($))) {
      const isSettingUp = await read($, settingUp)
      return (
        <Box flexDirection="column" paddingX={PAD} paddingTop={1}>
          <Text bold>🌱 OpenSpec isn't set up in this project.</Text>
          <Text dimColor>{`Setting it up runs \`${INIT.join(' ')}\`: it creates ${CHANGES}/ and the OpenSpec skills in .claude/.`}</Text>
          <Box marginTop={1}>
            {isSettingUp ? (
              <Text color="yellow">⏳ Setting up OpenSpec…</Text>
            ) : (
              <Button key="init" variant="primary" onPress={() => setUpOpenSpec($)}>
                🌱 Set up OpenSpec
              </Button>
            )}
          </Box>
        </Box>
      )
    }

    const run = (workflow: Workflow, args?: string) => () => void runWorkflow($, workflow, args)
    const specFs = { list: (path: string) => $.fs.list(path), read: (path: string) => $.fs.read(path) }
    const { active, archived, archivedTotal, archivedLeftOpen, archivedPage: page, archivedPages: pages } =
      await recentChanges(specFs, await read($, archivedPage), shown =>
        archivedRowsLeft(e.props.scroll.bodyRows, e.props.bodyColumns, shown),
      )
    // Archived changes closed with tasks unchecked turn the archive yellow, in the card and the list.
    const leftOpenNote = `⚠️ ${archivedLeftOpen} left open`
    const isExpanded = await read($, showArchived)
    const now = await $.clock.now()
    const hasTitle = e.props.bodyColumns >= WITH_TITLE
    // Every row and the header share these widths, so the columns line up whatever a row holds.
    const { nameWidth, titleWidth } = columnWidths(
      e.props.bodyColumns - 2 * PAD - 2,
      hasTitle,
      [...active, ...(isExpanded ? archived : [])].map(change => change.id),
    )
    // The buttons run OpenSpec workflows, as skills or /opsx: commands; say so when the session can
    // run some in neither form. An unreadable command list says nothing rather than warn about all.
    const available = await availableCommands($)
    const missing = available === undefined ? [] : missingWorkflows(available)
    // Files on disk that the session cannot run were added after Claude Code started (by the pane's
    // own setup, say): they load on a restart. A workflow with no file still has to be installed.
    const onDisk = await Promise.all(
      missing.map(async workflow => {
        const found = await Promise.all(filesOf(workflow).map(path => $.fs.stat(path).then(() => true, () => false)))
        return found.includes(true)
      }),
    )
    const toLoad = missing.filter((_, index) => onDisk[index])
    const toInstall = missing.filter((_, index) => !onDisk[index])

    // Without its workflows the pane can do nothing, so it says only what is missing and how to fix it.
    if (missing.length > 0) {
      return (
        <Box flexDirection="column" paddingX={PAD} paddingTop={1}>
          {toLoad.length > 0 && (
            <Box flexDirection="column" marginBottom={1}>
              <Text color="yellow">🔄 Restart Claude Code to load the OpenSpec workflows.</Text>
              <Text dimColor>
                {`${toLoad.join(', ')} ${toLoad.length === 1 ? 'is' : 'are'} installed, but this session started before; the pane works after a restart.`}
              </Text>
            </Box>
          )}
          {toInstall.length > 0 && (
            <Box flexDirection="column" marginBottom={1}>
              <Text color="yellow">{`⚠️ OpenSpec workflows not installed: ${toInstall.join(', ')}`}</Text>
              <Text dimColor>
                Run `openspec update --force` in the project to install them, then restart Claude Code.
              </Text>
            </Box>
          )}
        </Box>
      )
    }

    const postponed = active.filter(change => stateOf(change, now, staleDays) === 'postponed').length

    // A summary card: what there is, at a glance, and the two ways to start something.
    const start = (
      <Box borderStyle="round" borderColor="cyan" borderDimColor paddingX={2} marginBottom={1} flexWrap="wrap" justifyContent="space-between" columnGap={2}>
        <Box columnGap={2}>
          <Text bold color="cyan">
            OpenSpec
          </Text>
          <Text color="green">{`${ICON.active} ${active.length - postponed} active`}</Text>
          {postponed > 0 && <Text color="yellow">{`${ICON.postponed} ${postponed} postponed`}</Text>}
          <Text color={archivedLeftOpen > 0 ? "yellow" : undefined} dimColor={archivedLeftOpen === 0}>
            {`${ICON.archived} ${archivedTotal} archived${archivedLeftOpen > 0 ? ` · ${leftOpenNote}` : ""}`}
          </Text>
        </Box>
        <Box columnGap={1}>
          <Button key="explore" onPress={run('explore')}>
            🔍 Explore
          </Button>
          <Button key="propose" variant="primary" onPress={run('propose')}>
            ✏️ Propose
          </Button>
        </Box>
      </Box>
    )

    // Pressing a change shows its documents in this pane, on the proposal.
    const openDetail = async (change: Change) => {
      await update($, tab, () => 'proposal' as const)
      await update($, spec, () => null)
      await update($, viewing, () => ({ id: change.id, path: change.path }))
    }

    const actions = (change: Change, isDone: boolean) => {
      if (change.isArchived) return null
      const archive = (
        <Button
          key={`archive:${change.id}`}
          variant={isDone ? 'primary' : undefined}
          dimColor={!isDone}
          onPress={() => confirmArchive($, change.id)}
        >
          📦
        </Button>
      )
      if (isDone) return archive
      return (
        <>
          <Button key={`apply:${change.id}`} variant="primary" onPress={run('apply', change.id)}>
            🚀
          </Button>
          {archive}
        </>
      )
    }

    const divider = <Text dimColor>{'─'.repeat(Math.max(0, e.props.bodyColumns - 2 * PAD))}</Text>

    const row = (change: Change) => {
      const isDone = change.total > 0 && change.done === change.total
      const state = stateOf(change, now, staleDays)
      // An archived change with unchecked tasks was closed, not finished: it shows in yellow.
      const leftOpen = change.isArchived && change.total > change.done
      const tint = change.isArchived
        ? leftOpen
          ? 'yellow'
          : undefined
        : isDone
          ? 'green'
          : state === 'postponed'
            ? 'yellow'
            : 'cyan'
      const share = percentOf(change.done, change.total)
      const [filled, empty] = barParts(change.done, change.total)

      return (
        <Box key={`row:${change.path}`} flexDirection="column" paddingX={1} hover={{ backgroundColor: ROW_HOVER }}>
          <Box columnGap={1}>
            <Box width={nameWidth} flexShrink={0}>
              <Button
                key={`open:${change.path}`}
                plain
                label={fit(`${ICON[state]} ${change.id}`, nameWidth)}
                dimColor={state !== 'active'}
                onPress={() => openDetail(change)}
              />
            </Box>
            {hasTitle && (
              <Box width={titleWidth} flexShrink={0}>
                <Text dimColor italic wrap="truncate-end">
                  {change.title ?? ''}
                </Text>
              </Box>
            )}
            <Box width={PROGRESS} flexShrink={0}>
              {change.total === 0 ? (
                <Text dimColor>no tasks</Text>
              ) : (
                <Text>
                  <Text color={tint} dimColor={change.isArchived && !leftOpen}>
                    {filled}
                  </Text>
                  <Text dimColor>{empty}</Text>
                  <Text color={isDone ? 'green' : leftOpen ? 'yellow' : undefined} dimColor={!isDone && !leftOpen}>
                    {` ${String(share).padStart(3)}%`}
                  </Text>
                </Text>
              )}
            </Box>
            <Box width={WHEN} flexShrink={0} justifyContent="flex-end">
              <Text dimColor>{ago(now - change.mtimeMs)}</Text>
            </Box>
            <Box width={ACTIONS} flexShrink={0} columnGap={1} justifyContent="flex-end">
              {actions(change, isDone)}
            </Box>
          </Box>
          {!change.isArchived && change.next !== undefined && (
            <Box paddingLeft={3}>
              <Text dimColor wrap="truncate-end">
                <Text color={tint}>↳ </Text>
                {plainInline(change.next)}
              </Text>
            </Box>
          )}
          {leftOpen && (
            <Box paddingLeft={3}>
              <Text wrap="truncate-end">
                <Text color="yellow">{`↳ ⚠️ ${change.total - change.done} left open: `}</Text>
                <Text dimColor>{plainInline(change.next ?? '')}</Text>
              </Text>
            </Box>
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" paddingX={PAD} paddingTop={1}>
        {start}
        <Box columnGap={1} paddingX={1}>
          <Box width={nameWidth} flexShrink={0}>
            <Text bold dimColor>
              Change
            </Text>
          </Box>
          {hasTitle && (
            <Box width={titleWidth} flexShrink={0}>
              <Text bold dimColor>
                Title
              </Text>
            </Box>
          )}
          <Box width={PROGRESS} flexShrink={0}>
            <Text bold dimColor>
              Progress
            </Text>
          </Box>
          <Box width={WHEN} flexShrink={0} justifyContent="flex-end">
            <Text bold dimColor>
              Age
            </Text>
          </Box>
          <Box width={ACTIONS} flexShrink={0} />
        </Box>
        {divider}
        {active.length === 0 && (
          <Text dimColor italic>
            No active changes yet. Propose one to get started.
          </Text>
        )}
        {active.map(row)}
        {archivedTotal > 0 && (
          <Box marginTop={1} flexDirection="column">
            {divider}
            <Box columnGap={2}>
              <Button key="archived" plain dimColor={archivedLeftOpen === 0} onPress={() => void update($, showArchived, shown => !shown)}>
                {`${isExpanded ? '▾' : '▸'} ${ICON.archived} ${archivedTotal} archived`}
              </Button>
              {archivedLeftOpen > 0 && <Text color="yellow">{leftOpenNote}</Text>}
            </Box>
          </Box>
        )}
        {isExpanded && archived.map(row)}
        {isExpanded && pages > 1 && (
          <Box columnGap={2} marginTop={1} paddingX={1}>
            {page > 0 ? (
              <Button key="archived-newer" hotkey="p" onPress={() => void update($, archivedPage, () => page - 1)}>
                ◂ Newer
              </Button>
            ) : (
              <Text dimColor>[ ◂ Newer ]</Text>
            )}
            <Text dimColor>{`Page ${page + 1} of ${pages}`}</Text>
            {page < pages - 1 ? (
              <Button key="archived-older" hotkey="n" onPress={() => void update($, archivedPage, () => page + 1)}>
                Older ▸
              </Button>
            ) : (
              <Text dimColor>[ Older ▸ ]</Text>
            )}
          </Box>
        )}
      </Box>
    )
  })
}
