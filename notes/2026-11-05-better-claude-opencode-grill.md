# better-claude-opencode: Grill / Discovery Notes
Date: 2026-11-05 · Goal: plan a Claude Code mod that shows live opencode subagent activity and lets Claude wait or continue based on its status.

## Summary / key decisions
Established before the interview:
- Feasible without changing the MCP: read `opencode.db` read-only; `agent_id` is the opencode session ID.
- Updates arrive per block, not per token.
- Proposed parts: live pane, status tool, finish notice.

Decided:
- Targets both the desktop app and terminal `claude`.
- A finished agent wakes Claude, including from idle.
- Scope is this session's agents only.
- Status tool returns a compact summary, with a detail flag for more.
- Pane has a Stop button; follow-up messages stay with Claude in v1.
- If the database can't be read, the pane warns and the MCP carries on as normal.
- Personal for now, shareable later; no hardcoded database path.

First build step: a minimal mod that proves the pane displays in the desktop app, then test wake-up and the Stop call.

## Q&A log

### Q1 — Target surface
- Asked: Must it work in the desktop app, terminal `claude`, or both?
- Captured: Both. One mod; test the pane in the desktop app first, terminal is the fallback.
- Flags: Desktop pane support is still untested.

### Q2 — Finish behaviour
- Asked: How should Claude react when an agent finishes?
- Captured: Wake Claude. Notify during a turn; start a new turn if idle, so it collects the result and carries on unattended.
- Flags: Wake mechanism (`$.prompt.submit`, `$.session.append`) is untested.

### Q3 — Which agents to show
- Asked: Which opencode agents should the pane show?
- Captured: This session's agents only, tracked from the agent_ids its MCP tool calls return.
- Flags: None.

### Q4 — Status tool output
- Asked: How much should the status tool return to Claude?
- Captured: Compact summary: state, elapsed time, current tool, short recent-activity excerpt. A detail flag fetches more when needed.
- Flags: None.

### Q5 — Pane controls
- Asked: View-only, or controls in the pane?
- Captured: Add a Stop button so the user can kill a runaway agent from the pane; Claude is told it was stopped. No message box in v1.
- Flags: Calling the MCP `stop` tool from the mod (`$.mcp.call`) is untested.

### Q6 — Database read failure
- Asked: What if an opencode update stops the mod reading activity?
- Captured: Warn and degrade. Show a clear warning in the pane; the MCP's own wait and notifications keep working, so delegation is unaffected.
- Flags: None.

### Q7 — Audience
- Asked: Personal or shared?
- Captured: Personal, share later. Find the database with `opencode db path` rather than hardcoding it.
- Flags: None.

### Q8 — Completeness
- Asked: Anything not yet covered?
- Captured: No, plan is complete.
- Flags: None.

## Open flags (pending input)
- Does a mod pane display in the Claude desktop app? -> test with a first minimal mod
- Which opencode CLI and database does the MCP use (1.19.4 on PATH, 2.2.4 bundled with the desktop app)? -> verify during build
