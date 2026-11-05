# Question picker: Grill / Discovery Notes
Date: 2026-11-05 · Goal: settle how every opencode agent question reaches the user through Claude's option picker, then ship it.

## Summary / key decisions
- The agent writes the picker options: 2-4 with its recommendation first. Claude shows them as written and adds its own only if the agent gave none.
- The picker stays an instruction (`PICKER_RULE`), not enforced by a hook, so MCP behaviour is untouched.
- Install: the old `better-claude-opencode-local` registration was already gone, so nothing was removed; `./install.sh` passed. The mod loads from this folder.

Starting point: `PICKER_RULE` in `hooks/tracker.ts` tells Claude to use `AskUserQuestion` for every question. It is prompt-level and not enforced, Claude invents the options, the `QUESTION:` format is unchanged, and install is blocked by the old `better-claude-opencode-local` registration.

## Q&A log

### Q1 — Who writes the options
- Asked: agent or Claude writes the picker options?
- Captured: "Agent lists them". The QUESTION: rule asks for 2-4 options, recommendation first; Claude invents options only as a fallback.
- Flags: none

### Q2 — Enforcement
- Asked: instruction only, or block send_message until the picker ran?
- Captured: "Instruction only". No hook; Claude could occasionally skip the picker, accepted.
- Flags: none

### Q3 — Install
- Asked: remove the old registration and reinstall now?
- Captured: "Remove and reinstall". This replaces the earlier Not now.
- Flags: none

## Open flags (pending input)
- Real agent test of the picker -> user runs /reload-plugins, then one agent run
