# better-claude-opencode: spec

Decisions come from `notes/2026-11-05-better-claude-opencode-grill.md`.

## Goals
A Claude Code mod that shows live activity of this session's opencode subagents, and lets Claude wait or continue based on their status.

## Non-goals (v1)
- Per-token streaming: updates arrive per block.
- Agents from other sessions.
- Sending follow-up messages from the pane (stays with Claude).
- Changing `opencode-subagent-mcp`.

## Stack
Claude Code mod API (engine 2.1.317), TypeScript/TSX hooks module, no npm dependencies. `sqlite3` CLI via `$.process.run`, because the module has no Node. Verified against opencode 1.19.4 and opencode-subagent-mcp 0.1.3.

## Verified facts
- The MCP uses the PATH opencode (1.19.4). Its sessions are in the database printed by `opencode db path`. The desktop app's 2.2.4 server is unrelated.
- `agent_id` is the opencode session id. Tables used: `session`, `message`, `part` (`data` is JSON with `type`: `text`, `tool`, `step-start`, `step-finish`).
- Tool results end with a line `agent_id: <id> (...)`.
- Mod API available: `$.mcp.call`, `$.prompt.submit`, `$.session.append`, `$.process.run`, `$.clock.every`, `$.tool.register`, `$.ui.open`.

## Key problem: learning the id early
A blocking `agent` call returns its `agent_id` only when it ends or moves to the background, so the result alone cannot drive a live view. While such a call is in flight, the mod looks for root sessions (`parent_id` null) with `directory` = cwd created after the call began, and adopts them as provisional. The returned `agent_id` then confirms the match.
Limit: an unrelated opencode session started in the same directory during that window can appear until the result arrives.

## Architecture
All under the repo root, which is the plugin root.
- `hooks/register.tsx`: wiring: hooks, timer, pane, tool, command.
- `hooks/tracker.ts`: pure. Extracts ids from tool results; keeps the tracked agent list.
- `hooks/db.ts`: resolves the database path, runs read-only queries, reports failure as a value.
- `hooks/summary.ts`: pure. Turns rows into `AgentStatus`.
- `types/index.d.ts`: `$.state` contract.

## Data model
`AgentStatus`: `id, title, model, state (running|finished|stopped|unknown), startedAt, elapsedMs, currentTool?, recent (short excerpt), cost`.
State lives in `$.state`, so it survives reloads, and is scoped to the session.

## Flows
- **Track**: `tool.call` hook on the MCP's `agent`, `send_message`, `wait` adds ids.
- **Poll**: every 2 s while any agent is running; no polling otherwise.
- **Pane**: one row per agent; Stop on running rows calls the MCP `stop` through `$.mcp.call`, and Claude is told.
- **Status tool**: `opencode_status({ agent_id?, detail? })` returns the compact summary; `detail` adds more recent activity.
- **Finish**: on running to finished, wake Claude once with `$.prompt.submit`, unless its own MCP call already delivered that result. It collects the result and carries on.
- **Degrade**: any database failure shows a warning in the pane. MCP behaviour is untouched and nothing throws.

## Pane layout
```
opencode agents                     2 running · 1 done
● Fix parser tests   deepseek-flash  1m12s  bash    [Stop]
  running pytest -k parser
✓ Update docs        deepseek-flash  0m41s
! Activity unavailable: cannot read opencode database
```

## Definition of done
Pane shows in the desktop app and in terminal `claude`; a live agent's rows update; Stop works and Claude hears of it; the status tool answers; a finished agent wakes an idle Claude exactly once; a broken database path only warns. `claude plugin validate`, `tsc` and `claude plugin test` pass.
