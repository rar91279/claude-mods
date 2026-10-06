/** Whether the archived changes are listed below the active ones. */
export type ShowArchived = boolean

/** The id of the change the archive dialog asks about; null while it is closed. */
export type Archiving = string | null

/** The change the detail pane shows: its id and its folder. */
export type Viewing = { id: string; path: string } | null

/** The detail pane's tab. */
export type Tab = 'proposal' | 'design' | 'tasks' | 'specs'

/** The capability the specs tab shows; null for the first one. */
export type Spec = string | null

declare module 'claude-code' {
  interface PluginState {
    'openspec-pane': {
      showArchived: ShowArchived
      /** The page of archived changes shown, from 0. */
      archivedPage: number
      archiving: Archiving
      viewing: Viewing
      tab: Tab
      spec: Spec
      /** True while `openspec init` runs from the pane. */
      settingUp: boolean
    }
  }
}
