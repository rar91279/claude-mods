import type { Register } from 'claude-code'

import { CHANGES, ago, bar, recentChanges } from './openspec'

const PANE = 'openspec'
const TITLE = 'OpenSpec'

const touchesSpecs = (input: unknown) => JSON.stringify(input).includes('openspec')

export const register: Register = (on, options) => {
  const count = typeof options.count === 'number' ? options.count : 8

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'openspec',
      description: `Show the ${count} most recent OpenSpec changes in a pane`,
    })
    if (await $.fs.exists(CHANGES)) void $.ui.open({ id: PANE, title: TITLE })

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
    const { Box, Text } = $.ui.resolve(e)
    const changes = await recentChanges(
      { list: path => $.fs.list(path), read: path => $.fs.read(path) },
      count,
    )
    const now = await $.clock.now()

    if (changes.length === 0) {
      return <Text dimColor>No changes under {CHANGES}/ yet.</Text>
    }

    return (
      <Box flexDirection="column">
        {changes.map(change => {
          const isDone = change.total > 0 && change.done === change.total
          const tasks =
            change.total > 0 ? `${bar(change.done, change.total)} ${change.done}/${change.total}` : 'no tasks'
          const when = `${change.isArchived ? 'archived · ' : ''}${ago(now - change.mtimeMs)}`

          return (
            <Box key={change.id} flexDirection="column" marginBottom={1}>
              <Text bold={!change.isArchived} dimColor={change.isArchived} wrap="truncate-end">
                {`${change.isArchived ? '▪' : '●'} ${change.id}`}
              </Text>
              {change.title !== undefined && (
                <Text dimColor wrap="truncate-end">{`  ${change.title}`}</Text>
              )}
              <Text dimColor={change.isArchived} color={isDone ? 'green' : undefined}>
                {`  ${tasks} · ${when}`}
              </Text>
            </Box>
          )
        })}
      </Box>
    )
  })
}
