# better-claude-opencode: spec

Decisions come from `notes/2026-11-05-better-claude-opencode-grill.md`, the pane chat and question notes, and `docs/agents-plan-view-effort-chat-plan.md`.

## Goals
A Claude Code mod that shows live activity of this session's opencode subagents, and lets Claude wait or continue based on their status. Claude can register a numbered plan; the pane shows it as mission control, with a pixel robot, effort, model, variant and advisory dependencies per task. Claude rates each task's effort from a rubric in its instructions. A missing effort or model is filled from a configurable tier table using opencode's native variants.

## Non-goals (v1)
- Per-token streaming: updates arrive per block.
- Agents from other sessions.
- Sending follow-up messages from the pane (stays with Claude).
- Changing `opencode-subagent-mcp`.
- Starting, retrying or reordering tasks from the pane; dependencies are advisory and never enforced.

## Stack
Claude Code mod API (engine 2.1.317), TypeScript/TSX hooks module, no npm dependencies. `sqlite3` CLI via `$.process.run`, because the module has no Node. Verified against opencode 1.19.4 and opencode-subagent-mcp 0.1.3.

## Verified facts
- The MCP uses the PATH opencode (1.19.4). Its sessions are in the database printed by `opencode db path`. The desktop app's 2.2.4 server is unrelated.
- `agent_id` is the opencode session id. Tables used: `session`, `message`, `part` (`data` is JSON with `type`: `text`, `reasoning`, `tool`, `step-start`, `step-finish`), `todo` (what the agent's `todowrite` tool stores: `content`, `status`, `position`).
- Tool results end with a line `agent_id: <id> (...)`.
- Mod API available: `$.mcp.call`, `$.prompt.submit`, `$.session.append`, `$.process.run`, `$.clock.every`, `$.tool.register`, `$.ui.open`, `$.fs`.
- The MCP's `agent` accepts `effort`, mapped to opencode's model `variant`, and `model`; the session title is the call's `description`.
- `message.data` carries `tokens.total`, `cost` and `time.completed`; `part.data.state.output`, `part.data.state.metadata.diff` and `reasoning` text hold chat detail; `session` carries `tokens_*` and `cost`; `session.model` carries `{ providerID, id, variant }`.

## Key problem: learning the id early
A blocking `agent` call returns its `agent_id` only when it ends or moves to the background, so the result alone cannot drive a live view. While such a call is in flight, the mod looks for root sessions (`parent_id` null) with `directory` = cwd created after the call began, and adopts them as provisional. The returned `agent_id` then confirms the match.
Limit: an unrelated opencode session started in the same directory during that window can appear until the result arrives.

## Architecture
All under the repo root, which is the plugin root.
- `hooks/register.tsx`: wiring: hooks, timer, pane, tools, command, effort and plan injection.
- `hooks/pane.tsx`: pure render of the plan list and the open chat, with callbacks for open/stop/back/jump/toggle.
- `hooks/plan.ts`: pure. Plan normalization, effort/persona inference, variant resolution, task linking and stats.
- `hooks/mascot.ts`: pure. Draws the robot SVG: headgear shows effort, the antenna shows state.
- `hooks/config.ts`: defaults and loading of `<root>/.opencode-monitor/config.json`.
- `hooks/tracker.ts`: pure. Extracts ids from tool results; keeps the tracked agent list.
- `hooks/db.ts`: resolves the database path, runs read-only queries, reports failure as a value.
- `hooks/summary.ts`: pure. Turns rows into `AgentStatus`; formats chat, prompts and reports.
- `types/index.d.ts`: `$.state` contract.

## Data model
`AgentStatus`: `id, title, model, variant?, state (running|asking|finished|stopped|unknown), startedAt, elapsedMs, currentTool?, recent (short excerpt), cost, tokens, tasks?, question?`.
`Plan`: `{ title, createdAt, tasks }`; `PlanTask`: `{ id, title, persona, effort, after, model? }`; `Effort` is one of `minimal, low, medium, high, xhigh, max`; `Persona` is one of `scout, builder, tester, reviewer, general`.
`AgentHistory`: `{ id, entries, total }`, the log of the one open agent.
State lives in `$.state`, so it survives reloads, and is scoped to the session. Shapes: `history-3`, `chat-view-2`, `plan-1`, `plan-view-1`; old shapes are ignored, never migrated.

## Flows
- **Track**: `tool.call` hook on the MCP's `agent`, `send_message`, `wait` adds ids.
- **Poll**: every 2 s while any agent is running; no polling otherwise.
- **Plan**: `opencode_plan({ action?, title?, tasks? })` stores a plan, or clears it. The tool validates 1–50 tasks, fills missing ids, rejects duplicate ids and unknown or self `after` references, infers a missing persona and effort, and returns every task with its resolved model and variant plus the exact `<n>. <title>` description to pass to `agent`. A failed call returns a message and leaves the previous plan intact.
- **Effort and model**: before an `agent` call runs, an explicit effort wins; otherwise the linked plan task's effort, then inference from title and prompt. An explicit model wins; otherwise the plan task's model or the tier table's. The requested variant is resolved to the nearest supported variant for that model, with an equal distance picking the stronger one. The call receives `effort: <variant>` and `model`. `send_message` and `wait` are untouched. `effort.enabled: false` restores the old calls.
- **Pane**: the list view is plan-first. Without a plan it is the old agent list. With a plan it shows Cost/Tokens/Time for agents linked to the plan or started at/after it, Collapse/Clear, task rows with a robot (text persona glyph on the terminal), state, effort/model/variant, elapsed, current tool, advisory `after`, progress bar, question and recent activity, then an Unplanned section. No agent is ever dropped.
- **Stop**: Stop on a running row calls the MCP `stop` through `$.mcp.call`, and Claude is told.
- **History**: Open on a row replaces the list with that agent's chat, oldest first, latest 100 entries of up to 800 characters; Back returns to the plan. One agent is open at a time; it refreshes on each poll, and opening a finished agent loads it once. A pinned header holds the robot, plan task, progress bar, current task and a `Tasks n/m` button for the checklist. Each tool run between messages folds into one expandable line, with the latest step visible while running. A dim `── Turn n · 12s · 1.2k tok · $0.004 ──` divider opens each assistant message. Reasoning folds behind `Thinking · n lines`; expanding a tool run shows up to 6 output lines and a coloured diff of up to 20 lines, under a 15,000-character detail budget. Replies are plain Markdown; the task prompt is a bordered block of 3 rows with Show more. Scrolling up stops following and pins a Jump to latest button.
- **Tasks**: a `prompt.compose` section tells Claude to write a job-specific prompt with 2 to 6 tasks, and to have the agent keep them with `todowrite`. The pane and status tool draw progress from the `todo` table. An agent that ignores this shows no bar. The section reaches new sessions only, as a recorded prompt stands.
- **Status tool**: `opencode_status({ agent_id?, detail? })` returns the compact summary; `detail` adds more recent activity.
- **Finish**: on running to finished, wake Claude once with `$.prompt.submit`, unless its own MCP call already delivered that result. It collects the result and carries on.
- **Ask**: `tool.call` on the MCP's `agent` rewrites `prompt` to `prompts/system.txt` + the `QUESTION:` rule + Claude's task. `send_message` is left alone, as the agent keeps its history. An agent that ends a turn with a `QUESTION:` paragraph, listing 2 to 4 options with its recommendation first, is `asking`: the pane shows the question, and Claude is woken once with it, to put every question to the person with the `AskUserQuestion` option picker and relay the answer with `send_message`. Claude never answers one on its own. Answers go through Claude only. There is no limit on questions.
- **Continue**: until an agent stops being `asking`, or `finished` with open todos, each message the person sends carries that agent's id and question as hidden `prompt.submit` context, so the answer is relayed to the same agent. A finish with open todos wakes Claude to resume that agent with `send_message`, not to collect a result. Agents with a call in flight are left out.
- **Prompt file**: once an agent's id is confirmed, each poll that sees a new user message rebuilds `<project>/.opencode-monitor/<agentId>/prompt.txt` from the database: the first prompt, then dated `## Follow-up` or `## Answer` sections. The pane shows its path. The folder ignores itself in git.
- **Degrade**: any database or config failure shows a warning in the pane. MCP behaviour is untouched and nothing throws.

## Configuration
`<project root>/.opencode-monitor/config.json` is optional. A missing file uses the defaults. Invalid JSON or a bad entry shows one warning and keeps the defaults; a good part still applies.

```json
{
  "effort": {
    "enabled": true,
    "table": {
      "high": { "model": "opencode-go/deepseek-v4-pro", "variant": "high" }
    },
    "variants": {
      "deepseek-v4-pro": ["high", "max"]
    }
  }
}
```

The default table maps `minimal`/`low` to `deepseek-v4.1-flash`, `medium` to `glm-5.3-flash`, `high` to `deepseek-v4-pro`, and `xhigh`/`max` to `kimi-k3.1-pro`. The variants map covers those models and a few common alternatives so the nearest-supported rule works without calling `opencode models`.

## Pane layout
```
opencode agents                     2 running · 1 done
Ride Verdict MVP                          [Collapse] [Clear]

┌ Cost ─────┐ ┌ Tokens ──┐ ┌ Time ────┐
│ ≈$0.0042  │ │ 12.4k    │ │ 0:42     │
└───────────┘ └──────────┘ └──────────┘

Planned · 10 · 3 done
🦊  1. Scout the current API             ✓  0m41s
     low · deepseek-v4.1-flash · low
🦫  2. Core verdict engine               ●  1m12s bash
     high · deepseek-v4-pro · high
     after 1
🦉  3. Review the engine                 ○  planned
     xhigh · kimi-k3.1-pro · max
     after 2
Unplanned · 1
🐙  Hotfix typo                          ●  0m08s
     minimal · deepseek-v4.1-flash · low
```

## Definition of done
Pane shows in the desktop app and in terminal `claude`; a live agent's rows update; Stop works and Claude hears of it; the status tool answers; a plan resolves and links agents by numbered description; every agent call carries a sensible variant; a finished agent wakes an idle Claude exactly once; a broken database or config only warns. `claude plugin validate`, `claude plugin test` and (where a tsconfig is present) `tsc -p .` pass.
