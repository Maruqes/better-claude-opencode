# Plan: Plan-first Agents pane, automatic effort, and richer chat

**Generated**: 2026-11-05
**Estimated complexity**: High

## Overview

Turn the pane from a flat list of live agents into a small mission-control view:

- Claude registers a plan with `opencode_plan` (title + numbered tasks).
- Each task row shows a persona icon, the effort it asked for, the model and variant that actually ran, and its advisory dependencies.
- The plugin fills in a missing effort/model from a configurable tier table, using native opencode variants (`minimal`, `low`, `medium`, `high`, `xhigh`, `max`). Claude's explicit choice always wins.
- Run-level Cost, Tokens and Time sit above the plan.
- Opening a row keeps the existing full-pane chat, but each turn gains a subtle cost/token/time line, tool output previews, edit diffs and collapsible reasoning.

The MCP is untouched. The plugin already receives every `agent` tool call before it runs and already rewrites the `prompt`; it will also add `effort` and, when Claude did not pin one, `model`. The MCP maps `effort` to opencode's model `variant` (verified in `opencode-subagent-mcp` 0.1.3).

Claude remains the orchestrator: it decides when to start an agent. The plan is a shared, visible contract, not a scheduler.

## Out of scope (v1)

- Starting, retrying or reordering tasks from the pane.
- Enforcing dependencies (they are advisory only).
- Cross-session or cross-project plans and agents.
- Changing the MCP, its schema or its result format.
- Runtime discovery of model variants via `opencode models` (the config map covers it).
- Multiple chat panes or a fork of one agent's conversation.
- A scheduler, queue or automatic concurrency limit.

## Settled decisions

| Question | Decision |
| --- | --- |
| Pane shape | Plan view + live agents. Claude still spawns agents. |
| Plan source | New `opencode_plan` tool; plan stored in `$.state`. |
| Row ↔ agent link | Numbered agent description (`2. Core verdict engine`), parsed from the opencode session title. |
| Dependencies | Advisory only: show `after 1, 2` and warn about early starts; never block. |
| Effort authority | Claude decides; plugin fills missing/invalid values. |
| Effort effect | Model + reasoning variant. |
| Tier names | Native variants: `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. |
| Variant fallback | Nearest supported variant; an equal distance prefers the stronger one. |
| Mismatch | Claude's actual call wins; a dim note shows the planned value when it differs. |
| Icons | Persona per task type: scout, builder, tester, reviewer, general. |
| Icon style | Emoji on graphical surfaces; bracketed ASCII on terminal. |
| Model table | Balanced defaults, overridable in `.opencode-monitor/config.json`. |
| Chat upgrade | Richer turns: per-turn metrics, tool output, diffs, collapsible reasoning. |
| Turn metrics | Subtle dim line per assistant turn, always visible. |
| Plan lifecycle | `set` replaces the plan and resets its stats; a pane action clears it. Old agents stay readable as unplanned. |

## Prerequisites

- Claude Code mod engine with `$.tool.register`, `$.ui.resolve`, `$.process.run` and `e.surface` (the project targets 2.1.317).
- `opencode` on `PATH`, `sqlite3`, and the database printed by `opencode db path`.
- Verified in the current environment:
  - `agent` accepts `effort` and `model`; the MCP passes `effort` as the opencode `variant`.
  - `message.data` holds `tokens.total`, `cost` and `time.completed`.
  - `part.data.state.output` and `part.data.state.metadata.diff` hold tool output and edit diffs.
  - `part.data` of type `reasoning` holds the reasoning text.
  - `session.model` holds `{ providerID, id, variant }`.
  - `session` holds `tokens_input`, `tokens_output`, `tokens_reasoning`, `tokens_cache_read`, `tokens_cache_write`, `cost`.
- No new npm dependencies.

## Design

### 1. Data model

Add to `types/index.d.ts`:

```ts
export type Effort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type Persona = 'scout' | 'builder' | 'tester' | 'reviewer' | 'general'

export type PlanTask = {
  id: number
  title: string
  persona: Persona
  effort: Effort
  after: number[]
  model?: string
}

export type Plan = {
  title: string
  createdAt: number
  tasks: PlanTask[]
}
```

Extend `AgentStatus` with:

```ts
variant?: string   // the opencode model variant that actually ran
tokens: number     // input + output + reasoning, no cache
```

Add state atoms:

- `plan`: `Plan | null` (`plan-1`)
- `planView`: `{ isCollapsed: boolean }` (`plan-view-1`)

Bump shapes: `history-3`, `chat-view-2`. Old state is ignored, never migrated.

### 2. `opencode_plan`

Registered like `opencode_status`, under `mcp__opencode-agent-monitor__opencode_plan`.

```ts
{
  action?: 'set' | 'clear',
  title?: string,
  tasks?: Array<{
    id?: number,
    title: string,
    persona?: Persona,
    effort?: Effort,
    after?: number[],
    model?: string
  }>
}
```

Rules:

- `set` replaces the current plan; `clear` removes it.
- 1–50 tasks. Missing ids become 1..N. Ids must be unique positive integers.
- `after` entries must reference existing ids; self-references and unknown ids are rejected.
- Missing/invalid `persona` and `effort` are inferred once and stored.
- Titles are trimmed and capped at 120 characters; the plan title at 80.
- The tool never throws: validation failures return a plain `result` string.
- The return lists every task with its resolved persona, effort, model and variant, plus the exact `description` to pass to the `agent` tool. This keeps Claude's call consistent with the plan.

### 3. Effort and model resolution

New `hooks/config.ts`:

```ts
type MonitorConfig = {
  effort: {
    enabled: boolean
    table: Record<Effort, { model: string; variant: string }>
    variants: Record<string, string[]>
  }
}
```

Default table:

| Effort | Model | Requested variant | Resolved on current models |
| --- | --- | --- | --- |
| minimal | `opencode-go/deepseek-v4.1-flash` | low | low |
| low | `opencode-go/deepseek-v4.1-flash` | low | low |
| medium | `opencode-go/glm-5.3-flash` | medium | high |
| high | `opencode-go/deepseek-v4-pro` | high | high |
| xhigh | `opencode-go/kimi-k3.1-pro` | xhigh | max |
| max | `opencode-go/kimi-k3.1-pro` | max | max |

Default `variants` map for the models above plus a few common alternatives, so the nearest-supported rule works without calling `opencode models`:

```
deepseek-v4.1-flash: low, high, max
glm-5.3-flash:       low, high, max
deepseek-v4-pro:     high, max
kimi-k3.1-pro:       low, high, max
qwen3.8-flash:       low, medium, xhigh
qwen3.8-max:         low, medium, xhigh
minimax-m3.1-flash:  low, medium, high, xhigh, max
gpt-6-luna:          low, medium, high, xhigh, max
```

Resolution order for an `agent` call:

1. Normalize an explicit effort (accept legacy aliases `light→low`, `heavy→high`, `careful→xhigh`).
2. If absent or invalid, use the linked plan task's effort.
3. If still absent, infer from the title and prompt.
4. If Claude pinned `model`, keep it and choose the nearest supported variant.
5. Otherwise use the tier table's model and resolve its variant.
6. Pass `effort: <resolved variant>` and `model: <resolved model>` to the MCP.

Tie-break: equal rank distance picks the higher variant. Unknown model → pass the requested variant unchanged; live check confirms opencode's behaviour.

Config loading:

- Read `<project root>/.opencode-monitor/config.json` once per session; missing file uses defaults.
- Shallow-merge the `effort` section; validate each table entry.
- Invalid JSON or a bad entry returns a warning value and uses defaults. Never throw.
- `effort.enabled: false` disables injection entirely and shows the old pane behaviour.

### 4. Linking plans to agents

The MCP sets the opencode session title from the agent `description`. The plugin therefore links rows without extra state:

- `taskIdOf(title)` parses `^\s*(\d+)[.)]\s+`.
- If numbering is absent, match the normalized title exactly against plan task titles.
- `planRows(plan, statuses)` returns each task with all linked agents; the newest by `startedAt` is the face of the row.
- Agents that match no task appear under **Unplanned**, so nothing is hidden when Claude skips the plan or uses a different description.
- Replacing a plan does not touch agents: they simply become unplanned until descriptions match a new plan.

### 5. Pane layout

No plan, no agents: current empty state.

Plan present:

```
opencode agents                        2 running · 1 done
Ride Verdict MVP                         [Collapse] [Clear]

┌ Cost ─────┐ ┌ Tokens ──┐ ┌ Time ────┐
│ ≈$0.0042  │ │ 12.4k    │ │ 0:42     │
└───────────┘ └──────────┘ └──────────┘

Planned · 10 · 3 done
🦊  1. Scout the current API             ✓  0m41s
     low · deepseek-v4.1-flash · low
🦫  2. Core verdict engine               ●  1m12s  bash
     high · deepseek-v4-pro · high
     after 1
🦉  3. Review the engine                 ○  planned
     xhigh · kimi-k3.1-pro · max
     after 2
...
Unplanned · 1
🐙  Hotfix typo                          ●  0m08s
     minimal · deepseek-v4.1-flash · low
```

Details:

- Persona glyph: 🦊 scout, 🦫 builder, 🐸 tester, 🦉 reviewer, 🐙 general.
- Terminal surface uses `[S] [B] [T] [R] [*]` instead of emoji; choose by `e.surface === 'terminal'`.
- State glyph reuses the existing running/asking/finished/stopped/unknown set; planned rows use `○`.
- Meta line: requested effort, actual `model · variant`, elapsed and current tool. If the actual effort differs from the plan, append a dim `planned high`.
- Dependencies: `after 1, 2` dim. If the task is running while a dependency is not settled, show `! started before 1, 2` in warning colour.
- Open appears only when an agent exists; planned rows show the clock/state only.
- Multiple agents on one task show `×2`; Open uses the newest. Older ones remain in the database and in `prompt.txt`.
- At narrow widths (`bodyColumns < 50`) the stats cards stack vertically and the meta line wraps.
- Collapse hides stats and the task list, keeping the plan title and counts. Clear removes the plan (agents stay).
- Plan rows reuse the existing task progress bar, current question and recent activity.

Chat view header gains the persona and keeps the plan context:

```
[Back]                    [Tasks 2/5] [Stop]
🦫  2. Core verdict engine
high · deepseek-v4-pro · high · 1m12s · bash
```

### 6. Richer chat turns

Extend the history query and `ChatEntry`:

- `HistoryRow`: add `message_id`, `part_id`, `output`, `diff`, `tokens`, `cost`, `time_created`, `time_completed`.
- SQL: `json_extract(m.data,'$.tokens.total')`, `json_extract(m.data,'$.cost')`, `json_extract(m.data,'$.time.completed')`, and bounded `substr` of `state.output` (2000) and `state.metadata.diff` (4000).
- `toEntry`:
  - `tool` keeps its title and gains `output`/`diff`.
  - `reasoning` becomes a `reasoning` entry with its text.
  - text/replies unchanged.
- `groupChat` emits a `turn` item when the assistant `message_id` changes:

```ts
{ kind: 'turn', id, tokens, cost, durationMs, index }
```

Rendered as one dim line:

```
Turn 2 · 12s · 1.2k tok · $0.004
```

- Reasoning renders as a collapsed `Thinking · N lines` button; expanding shows dim text. Store its id in `chatView.expanded`.
- Expanding a tool run shows each step's title plus:
  - up to 6 lines of output (dim), and
  - a diff code block of up to 20 lines, with a truncation note.
- The latest running step stays visible while collapsed, as today.
- Detail budget: while rendering an expanded run, stop emitting output/diff after 15,000 characters and add `… more detail hidden`. This keeps the pane under its 100k character draw limit.
- Turn metrics use message-level values, so tools and reasoning in the same assistant message share one line.

## Sprints and tasks

### Sprint 1: Pure foundations

**Goal**: types, config and effort/plan logic exist and are tested without touching the UI.

**Demo/validation**:
- `claude plugin test .` passes.
- A unit test shows `careful` → `xhigh`, `medium` on glm-5.3-flash → `high`, and a numbered title linking to a task.

#### Task 1.1: Add plan and status types

- **Location**: `types/index.d.ts`
- **Description**: Add `Effort`, `Persona`, `PlanTask`, `Plan`; extend `AgentStatus` with `variant` and `tokens`; register `plan` and `planView` in `PluginState`.
- **Dependencies**: none
- **Acceptance**: `tsc -p .` accepts the new shapes; no existing type is removed.
- **Validation**: `tsc -p .`.

#### Task 1.2: Add `hooks/plan.ts`

- **Location**: `hooks/plan.ts` (new)
- **Description**: Pure functions: `inferEffort`, `inferPersona`, `normalizeEffort`, `normalizePlan`, `resolveEffort`, `resolveVariant`, `taskIdOf`, `planRows`, `planStats`, `formatPlanSet`, `formatTokens`, `formatCost`, `formatClock`.
- **Dependencies**: 1.1
- **Acceptance**: no `$` or DOM imports; all decisions above are represented; invalid input returns a value, never throws.
- **Validation**: new `tests/plan.test.ts`.

#### Task 1.3: Add `hooks/config.ts`

- **Location**: `hooks/config.ts` (new)
- **Description**: Default table and variant map; `loadConfig($)` reads `<root>/.opencode-monitor/config.json`, merges and validates, returns `{ config, warning? }`.
- **Dependencies**: 1.1
- **Acceptance**: missing file → defaults; invalid JSON → defaults + warning; `enabled: false` respected.
- **Validation**: new `tests/config.test.ts` with a fake `$`.

#### Task 1.4: Test effort and plan rules

- **Location**: `tests/plan.test.ts`
- **Description**: Table-driven tests for inference aliases, persona selection, nearest/tie→stronger variant, plan validation, `after` checks, numbered linking, duplicate agents per task, stats formatting.
- **Dependencies**: 1.2
- **Acceptance**: every row of the decisions table has at least one test.
- **Validation**: `claude plugin test .`.

### Sprint 2: Plan tool and prompt contract

**Goal**: Claude can register a plan; the pane has a stable plan state and agents link to rows.

**Demo/validation**:
- A test calls `opencode_plan` and reads back a resolved task table.
- `opencode_plan` with a bad dependency returns an error string and leaves the old plan intact.
- A started agent whose title is `2. Core verdict engine` links to task 2.

#### Task 2.1: Register `opencode_plan`

- **Location**: `hooks/register.tsx`
- **Description**: Register the tool in `session.start`; add a `tool.call` handler for `mcp__opencode-agent-monitor__opencode_plan`; `set` writes `plan`, `clear` writes `null`.
- **Dependencies**: 1.2, 1.3
- **Acceptance**: tool appears with a clear description and schema; failures return `{ result }` and do not throw.
- **Validation**: `tests/pane.test.tsx` or a new `tests/plan-tool.test.ts`.

#### Task 2.2: Validate and format the plan

- **Location**: `hooks/plan.ts`, `hooks/register.tsx`
- **Description**: Use `normalizePlan`; return the resolved table, exact description strings, and effort/model/variant per task.
- **Dependencies**: 2.1
- **Acceptance**: ids, duplicate ids, unknown `after`, empty titles and >50 tasks are rejected with readable messages.
- **Validation**: unit tests.

#### Task 2.3: Add the plan section to `prompt.compose`

- **Location**: `hooks/register.tsx`
- **Description**: Add `PLAN_SECTION`: call `opencode_plan` before a multi-agent job; 1–10 tasks; one agent per task; description exactly `<n>. <title>`; pass the plan's effort/model; start only after `after` tasks. Keep the existing `todowrite` delegation rules.
- **Dependencies**: 2.1
- **Acceptance**: the composed sections contain both `opencode_plan` and `todowrite`, with no contradictory instruction.
- **Validation**: extend the existing prompt test.

#### Task 2.4: Link rows by numbered title

- **Location**: `hooks/plan.ts`, pane render
- **Description**: Derive `planRows` on each render/poll; expose unplanned agents separately; never mutate the plan to link.
- **Dependencies**: 2.1
- **Acceptance**: renames show as unplanned; two agents on one task show `×2`; replacing the plan never loses agents.
- **Validation**: unit + pane tests.

### Sprint 3: Automatic effort and model

**Goal**: an `agent` call always carries a sensible effort/model; Claude's explicit choice wins.

**Demo/validation**:
- A hooked `agent` call without effort receives the table's model and variant.
- A call with `model` pinned keeps the model and normalizes the variant.
- `send_message` is unchanged.
- `effort.enabled: false` leaves the call untouched.

#### Task 3.1: Inject effort/model into `agent`

- **Location**: `hooks/register.tsx`
- **Description**: Before `next(e)`, resolve the task/prompt/title and rewrite `effort` and `model`. Preserve the prompt composition. Do it only for `agent`.
- **Dependencies**: 1.2, 1.3, 2.4
- **Acceptance**: explicit effort wins; pinned model wins; plan effort fills a gap; inference is the final fallback.
- **Validation**: hook test asserting the object passed to `next`.

#### Task 3.2: Add model variant to `AgentStatus`

- **Location**: `hooks/db.ts`, `hooks/summary.ts`, `types/index.d.ts`
- **Description**: Select `json_extract(model,'$.variant')`; set `AgentStatus.variant`; omit `default`.
- **Dependencies**: 1.1
- **Acceptance**: the pane can show the actual model · variant; old rows without a variant render unchanged.
- **Validation**: `tests/summary.test.ts`, `tests/db.test.ts`.

#### Task 3.3: Handle config and failure paths

- **Location**: `hooks/register.tsx`, `hooks/config.ts`
- **Description**: Cache the loaded config per session; on a bad config show one warning; never fail an MCP call because effort resolution failed.
- **Dependencies**: 1.3, 3.1
- **Acceptance**: invalid config still starts the agent with the original args; a warning appears once.
- **Validation**: hook test with a bad config.

#### Task 3.4: Test the matrix

- **Location**: `tests/plan.test.ts`, `tests/pane.test.tsx`
- **Description**: Cover every effort, aliases, pinned model, unsupported variant tie, disabled mode, plan mismatch and `send_message`.
- **Dependencies**: 3.1–3.3
- **Acceptance**: each path has an assertion on the outgoing args.
- **Validation**: `claude plugin test .`.

### Sprint 4: Plan-first pane

**Goal**: the pane matches the agreed layout and stays usable on every surface and width.

**Demo/validation**:
- Mount a plan with 10 tasks and mixed states; see stats, personas, effort/model, dependencies, collapse/clear and unplanned agents.
- Terminal shows ASCII personas; desktop shows emoji.

#### Task 4.1: Extract the render tree

- **Location**: `hooks/register.tsx`, `hooks/pane.tsx` (new)
- **Description**: Move the existing list/chat render into `renderPane($, e, ctx)` with callbacks for open/stop/back/jump/toggle; no behaviour change.
- **Dependencies**: none beyond the current code
- **Acceptance**: all existing pane tests pass unchanged.
- **Validation**: `claude plugin test .`.

#### Task 4.2: Plan header and stats

- **Location**: `hooks/pane.tsx`
- **Description**: Plan title, counts, Collapse/Clear buttons, Cost/Tokens/Time cards, `Planned · N · M done`.
- **Dependencies**: 4.1
- **Acceptance**: stats scope is agents started at/after `plan.createdAt` plus linked agents; time freezes when all are settled; zero states render `≈$0.00`, `0`, `0:00`.
- **Validation**: pane tests with fixed clock values.

#### Task 4.3: Task rows

- **Location**: `hooks/pane.tsx`
- **Description**: Persona glyph, number/title, state, effort/model/variant, elapsed/tool, `after` warning, progress bar, question, recent line, Open/Stop.
- **Dependencies**: 4.2
- **Acceptance**: planned/running/asking/finished/stopped/unknown and multiple agents per task all render; narrow widths wrap without overlap.
- **Validation**: pane tests across terminal/desktop/vscode/mobile.

#### Task 4.4: Unplanned agents and empty states

- **Location**: `hooks/pane.tsx`
- **Description**: Section for agents that match no task; keep the current empty state and the no-plan list.
- **Dependencies**: 4.3
- **Acceptance**: no agent ever disappears because of a plan; clearing a plan returns the old list.
- **Validation**: pane tests.

#### Task 4.5: Chat header context

- **Location**: `hooks/pane.tsx`
- **Description**: Add persona and plan task context to the pinned chat header; keep `headerRows` in sync.
- **Dependencies**: 4.1
- **Acceptance**: the pinned header still overlays correctly when scrolled; Back returns to the plan.
- **Validation**: existing pinned-header test plus a plan variant.

### Sprint 5: Richer chat turns

**Goal**: the open chat shows per-turn cost/tokens/time, tool output, diffs and reasoning without breaking live following.

**Demo/validation**:
- Seed history with two assistant turns: one bash output, one edit diff, one reasoning part.
- See subtle turn lines, expandable output/diff and a Thinking toggle.
- A live poll still follows the bottom; scrolling up still pins Jump to latest.

#### Task 5.1: Extend the history query

- **Location**: `hooks/db.ts`
- **Description**: Add message id, part id, tokens, cost, times, bounded output and diff; include `reasoning` parts.
- **Dependencies**: none (independent of the pane)
- **Acceptance**: no query fails on a real database; fields are `null` rather than absent when missing.
- **Validation**: `tests/db.test.ts` asserts the SQL and mapping.

#### Task 5.2: Extend `formatChat` / `groupChat`

- **Location**: `hooks/summary.ts`, `types/index.d.ts`
- **Description**: Add `reasoning` entries and tool `output`/`diff`; emit `turn` items keyed by `message_id`; keep prompt/reply/tool/error kinds compatible.
- **Dependencies**: 5.1
- **Acceptance**: ordering is oldest→newest; tool runs still fold; reasoning is not folded into a tool run; duplicate adjacent tools still collapse.
- **Validation**: `tests/summary.test.ts`.

#### Task 5.3: Render turns and detail

- **Location**: `hooks/pane.tsx`
- **Description**: Dim turn line, reasoning toggle, expanded tool output/diff, truncation notes, 15k detail budget.
- **Dependencies**: 5.2, 4.1
- **Acceptance**: collapsed view stays as clean as today; expanded view never exceeds the pane draw limit; `chatView.expanded` survives polls.
- **Validation**: pane tests, including a 100-part history stress case.

#### Task 5.4: Test live-follow interaction

- **Location**: `tests/pane.test.tsx`
- **Description**: Ensure new items do not fight the pinned header, Jump to latest, or the `endsAtBottom` rule.
- **Dependencies**: 5.3
- **Acceptance**: existing scroll tests pass; new turn lines do not reset following.
- **Validation**: `claude plugin test .`.

### Sprint 6: Verification, docs and knowledge

**Goal**: the feature is proven in the real app and the project knowledge matches the code.

**Demo/validation**:
- `claude plugin validate .`, `claude plugin test .`, `tsc -p .` pass.
- `./install.sh`, a new session, a 3-task plan, real agents; verify effort/variant, stats, deps and chat details.
- Terminal and desktop both checked.

#### Task 6.1: Full static and test pass

- **Location**: repo root
- **Description**: Run the three commands; fix regressions.
- **Dependencies**: Sprints 1–5
- **Acceptance**: all pass.
- **Validation**: command output recorded in the task/PR.

#### Task 6.2: Live plan run

- **Location**: real Claude session; `./install.sh`
- **Description**: Ask for a 3-task job; confirm `opencode_plan` is called, agents start with numbered descriptions, variants appear in `session.model`, and the pane stats match SQL.
- **Dependencies**: 6.1
- **Acceptance**: no MCP behaviour change; a missing plan still shows unplanned agents; effort can be disabled in config.
- **Validation**: manual check in desktop and terminal.

#### Task 6.3: Update project docs

- **Location**: `docs/SPEC.md`, `docs/PLAN.md`, `filemap.md`, `README.md` if needed
- **Description**: Document the new tool, state, flows, pane layout, config file and chat detail; add the new files to the map; add sprint entries to `PLAN.md`.
- **Dependencies**: 6.1
- **Acceptance**: docs describe the shipped behavior, including advisory dependencies and the fallback path.
- **Validation**: read-through against the code.

#### Task 6.4: Update SilverBullet knowledge

- **Location**: `knowledge/projects/better-claude-opencode/`
- **Description**: Update the canonical feature, contract, architecture and decision pages; add the plan tool and effort table; refresh `reviewed_on`, `source_commit` and `sources`. No routine progress logs.
- **Dependencies**: 6.1
- **Acceptance**: one home per fact; code and pages agree.
- **Validation**: read the index routes and changed pages.

## Testing strategy

- **Unit**: `plan.ts` (inference, aliases, variants, validation, linking, stats), `config.ts` (defaults/merge/failures), `summary.ts` (turns, reasoning, output, diffs), `db.ts` (SQL shape and null fields).
- **Hook**: outgoing `agent` args with every effort path; `send_message` untouched; plan tool set/clear/invalid; config disabled; wake and prompt behavior unchanged.
- **Component**: pane across `terminal`, `desktop`, `vscode` and `mobile`; emoji/ASCII; narrow widths; collapsed/expanded; clear; unplanned; pinned header; jump to latest; 100-part history.
- **Live**: real opencode agents; inspect `session.model.variant`; compare pane Cost/Tokens/Time with SQL; confirm no MCP change.

Commands:

```
claude plugin validate .
tsc -p .
claude plugin test .
./install.sh
```

## Potential risks and gotchas

1. **Description-based linking is the fragile point.** Claude may rename a task. Mitigate with the exact `<n>. <title>` rule, a normalized-title fallback, and the Unplanned section. Never drop an agent.
2. **`description` is the opencode session title.** Do not rewrite it in the tool-call hook; rewriting would break linking and the user's view of the task.
3. **Variant support changes with models.** The config map can go stale. Unknown models pass the requested variant through; the live check verifies acceptance. A bad variant must degrade to the original call, not fail the agent.
4. **`effort.enabled: false` is the emergency brake.** It must restore the old behavior without a code change.
5. **Pane draw limit.** History is already 100 × 800 characters; output/diffs can blow the 100k limit. Only expanded runs draw detail, cap each field, and enforce a 15k detail budget.
6. **Emoji width.** Some terminals mis-measure emoji. Terminal gets ASCII by default; graphical surfaces get emoji. Check both in the live run.
7. **Narrow panes.** Three stats cards do not fit at 40 columns. Stack them under a threshold and wrap meta lines.
8. **Plan replacement mid-run.** Stats reset and old agents become unplanned. That is intended, but the pane must not lose them.
9. **Time aggregation.** Use plan creation → last settled agent/frozen; do not sum per-agent elapsed, which double-counts parallel work.
10. **Stats scope.** Include agents started at/after the plan and linked agents; document the rule so Cost/Tokens match what the person sees.
11. **Plan tool called late.** Linking is retrospective by title, so rows still attach. Test it.
12. **No plan at all.** The old list with inferred persona/effort must remain fully usable.
13. **Prompt section conflict.** The existing delegation section already tells Claude to use `todowrite`; add the plan instructions without contradicting it.
14. **Tool registration timing.** Register `opencode_plan` in `session.start`; a reload rebuilds state from `$.state`.
15. **History query cost.** Extra JSON extraction on 100 parts per open chat; bounded `substr` and an index-friendly query keep it acceptable. Measure on a real DB.
16. **Per-turn metrics missing.** Older messages may lack tokens/cost; render nothing rather than `0` or `$0.00`.
17. **Expanded state key collisions.** Reasoning ids must be namespaced (e.g. `reasoning-<part_id>`) so a tool change and a reasoning toggle cannot share an id.
18. **Multiple agents per task.** `×2` must not hide the older agent's cost; stats include all agents, not just the newest.
19. **Plan validation must not throw.** A failed `opencode_plan` call should leave the previous plan intact and return a readable message.
20. **Config file is optional.** A missing or broken file must never be a blocker; defaults are always valid.

## Rollback plan

- Set `effort.enabled: false` in `.opencode-monitor/config.json` to stop all call rewriting immediately.
- Clear the plan from the pane; the old agent list returns.
- Revert commits per sprint. Data remains readable: the database is only read, and state shapes for old versions are ignored on load.
- If the pane extraction causes a regression, revert the `hooks/pane.tsx` commit; the feature commits depend on it, so land the extraction as its own commit.
- No migration is required; `plan` and `planView` can be dropped without touching stored agents or history.

## Definition of done

- Claude can register a numbered plan and start one agent per task with `<n>. <title>` descriptions.
- Every `agent` call carries a sensible native variant and model; explicit choices win; a disabled config leaves calls untouched.
- The pane shows the plan, stats, persona icons, effort/model/variant, advisory dependencies, state and unplanned agents.
- Opening a row shows the existing chat plus per-turn cost/tokens/time, tool output, edit diffs and collapsible reasoning.
- Desktop and terminal both render; narrow widths do not break.
- `claude plugin validate`, `tsc` and `claude plugin test` pass; a real 3-task run matches the database.
