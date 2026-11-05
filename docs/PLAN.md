# Plan

All workers: `savvy-light` (Opus, low), by the user's request.

1. **Scaffold and pane proof** [x]. Manifest, hooks.json, contract, minimal pane and `/opencode-agents` command. Verify: validate, tsc. After: nothing.
2. **Tracker and database reader** [ ]. `tracker.ts`, `db.ts`, `summary.ts`, with tests on sample rows and id parsing. Verify: plugin test. After: 1.
3. **Pane, polling and Stop** [ ]. Wire the tracker and poll into the pane per SPEC layout; Stop; degrade warning. Verify: plugin test. After: 2.
4. **Status tool** [ ]. `opencode_status`. Verify: plugin test. After: 2.
5. **Finish wake-up** [ ]. Once-only wake with the no-duplicate rule. Verify: plugin test. After: 3, 4.
6. **Live check** (orchestrator) [ ]. Load the mod and run a real agent in desktop and terminal. After: 5.
