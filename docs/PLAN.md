# Plan

All workers: `savvy-light` (Opus, low), by the user's request.

1. **Scaffold and pane proof** [x]. Manifest, hooks.json, contract, minimal pane and `/opencode-agents` command. Verify: validate, tsc. After: nothing.
2. **Tracker and database reader** [x]. `tracker.ts`, `db.ts`, `summary.ts`, with tests on sample rows and id parsing. Verify: plugin test. After: 1.
3. **Pane, polling and Stop** [x]. Wire the tracker and poll into the pane per SPEC layout; Stop; degrade warning. Verify: plugin test. After: 2.
4. **Status tool** [x]. `opencode_status`. Verify: plugin test. After: 2.
5. **Finish wake-up** [x]. Once-only wake with the no-duplicate rule. Verify: plugin test. After: 3, 4.
6. **Live check** (orchestrator) [ ]. Load the mod and run a real agent in desktop and terminal. After: 5.
7. **Agent history and task progress** [x]. Open/Close log per agent, delegation prompt section, `todo`-based bar. Verify: plugin test. After: 5.
8. **Live check of 7** (orchestrator) [ ]. New session, real agent: bar advances, log updates. After: 7.
9. **Claude and opencode communication** [x]. Prompt injection, `QUESTION:` detection, `asking` state and wake, prompt.txt. Verify: plugin test. After: 7.
10. **Live check of 9** (orchestrator) [ ]. Real agent asks, Claude answers, prompt.txt holds both. After: 9.
11. **Plan-first pane and automatic effort** [x]. `opencode_plan`, plan state and linking, persona/effort/model/variant rows, config tier table, `agent` call injection, unplanned agents, collapse/clear. Verify: plugin test. After: 9.
12. **Richer chat turns** [x]. Per-turn cost/tokens/time, reasoning toggle, tool output previews, edit diffs and the 15k detail budget. Verify: plugin test. After: 11.
13. **Live check of 11–12** (orchestrator) [ ]. New session, 3-task plan, real agents; verify effort/variant, stats, dependencies and chat details in desktop and terminal. After: 12.
