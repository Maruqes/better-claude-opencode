docs/SPEC.md — goals, architecture, flows; read first
docs/PLAN.md — task list and status
notes/ — discovery notes behind the spec
.claude-plugin/plugin.json — mod manifest
hooks/hooks.json — points to the hooks module
hooks/register.tsx — wiring: hooks, timer, pane, tool, command
hooks/tracker.ts — id extraction and tracked agents (pure)
hooks/db.ts — read-only opencode database access
hooks/summary.ts — rows to AgentStatus (pure)
types/index.d.ts — $.state contract
