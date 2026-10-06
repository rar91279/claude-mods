# openspec-pane

A Claude Code mod that shows your [OpenSpec](https://github.com/Fission-AI/OpenSpec) changes in a pane, each with its task progress and the next open task.

```
╭──────────────────────────────────────────────────────────────╮
│ OpenSpec  🟢 1 active  ⏸️ 1 postponed  📦 23 archived           │
│                                  [ 🔍 Explore ] [ ✏️ Propose ] │
╰──────────────────────────────────────────────────────────────╯
Change                         Progress       Age
────────────────────────────────────────────────────────────────
🟢 backend-hardening           █████░░░  63%   2h    [ 🚀 ] [ 📦 ]
   ↳ 4.2 Wire the shutdown drain
⏸️ retry-policy                █░░░░░░░  11%  21d    [ 🚀 ] [ 📦 ]

────────────────────────────────────────────────────────────────
▸ 📦 23 archived
```

- `/openspec` opens the pane. It also opens by itself at session start when the working directory has an `openspec/changes/` folder (unasked panes are only placed in a terminal at least 144 columns wide). While the pane is closed in a project with OpenSpec, a band above the prompt shows **📋 OpenSpec** with the counts (active, archived, left open); pressing it opens the pane, and the band goes away until the pane is closed again.
- Where the project has no `openspec/changes/` yet, the pane says so and offers 🌱 **Set up OpenSpec**, which runs `openspec init --tools claude --no-animation --no-copilot-cloud` (through `cmd /c` where `openspec` is a `.cmd` shim) and then shows the empty table with Explore and Propose. A failure shows as a toast.
- Every active change, newest first by the newest file directly inside its folder, with the first unchecked task beneath it. 🟢 is active, ⏸️ postponed (OpenSpec has no such state: it means nobody touched the change for `staleDays`, default 14), 📦 archived. The archived ones (`openspec/changes/archive/`) collapse into one `▸ N archived` line; pressing it lists them a page at a time, newest first, without buttons, each page as tall as the pane has room for; ◂ Newer and Older ▸ (keys `p`, `n`) turn the pages.
- **Explore** runs `/openspec-explore`, **Propose** `/openspec-propose`. Each active row's main action is highlighted: **Apply** (`/openspec-apply-change <id>`) while tasks are open, **Archive** once all are checked. Archive asks first, in the pane itself: a yellow card lists any open tasks; only **Archive** there runs the archive workflow, **Cancel** (key `c`) goes back to where it was pressed. A Title column appears when the pane is at least 90 columns wide.
- Pressing a change's name shows it in the OpenSpec pane in place of the list (**← OpenSpec** at the top, or key `b`, goes back), with tabs 📄 Proposal, 📐 Design, ✅ Tasks and 📚 Specs (keys 1–4). Each shows the file as Markdown, cut at 10 000 characters; tasks read as a checklist (☐ bold while open, ✅ when done), and specs show their delta sections, 📋 requirements, 🎬 scenarios and 🔹 Given / ⚡ When / ✅ Then / ➕ And steps; Specs has one entry per `specs/<capability>/spec.md`. The pane scrolls. An active change also gets 🚀 **Apply** (key `a`, while tasks are open) and 📦 **Archive** (key `x`, highlighted once all tasks are checked); Apply goes back to the list and runs the apply workflow, Archive asks for confirmation in the pane.
- The title is the first `#` heading of `proposal.md` (a `Change:` prefix is dropped); the progress counts `- [ ]` / `- [x]` lines in `tasks.md` and turns green when all are checked. A bar is full, and the share reads 100%, only when every task is checked. An archived change with unchecked tasks shows in yellow with a `↳ ⚠️ N left open` line, and while any archived change has them, the archive count in the summary card and the `▸ 📦 N archived` line turn yellow with `⚠️ N left open` (that count reads every archived tasks.md), and the ✅ Tasks tab of any change starts with its open tasks, grouped by section heading. A ☐ in front of a task in that card checks it in that change's `tasks.md` (only if the line is still that open task; otherwise a toast says the file changed).
- The buttons run the OpenSpec workflows explore, propose, apply and archive in whichever form is installed: the skill (`openspec-explore`, …) or, with the CLI's `delivery: commands`, the `/opsx:` command (`opsx:explore`, …). When the session has some in neither form, the pane shows only that, with no buttons or table: 🔄 restart Claude Code when their files are in `.claude/skills/` or `.claude/commands/opsx/` but the session started before (after 🌱 Set up OpenSpec, say), ⚠️ run `openspec update --force` when they are not there at all.
- Redraws after any Write, Edit, Bash or PowerShell call that mentions `openspec`. Edits made outside Claude show up on the next redraw.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `staleDays` ("Postponed after (days)") | 14 | Days without a touched file before an active change shows as postponed |

Set them in the `/config` menu, or in settings under `pluginConfigs.openspec-pane.<option>`.

## Install

From the marketplace:

```sh
claude plugin marketplace add rar91279/claude-mods
claude plugin install openspec-pane@claude-mods
```

Or load it from a clone of this repository:

```sh
claude --plugin-dir /path/to/claude-mods/openspec-pane
```

or add the folder to `CLAUDE_CODE_PLUGIN_DIRS`.

## Develop

```sh
claude plugin validate openspec-pane
claude plugin test openspec-pane
```

`.claude-plugin/types/` is generated by Claude Code when the mod loads; `tsconfig.json` extends it, so `tsc -p openspec-pane` type-checks once the mod has been loaded once.
