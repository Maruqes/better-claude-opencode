AGENTS.md — agent rules and knowledge workflow; CLAUDE.md links to it
install.sh — install or update the mod for every session
.claude-plugin/marketplace.json — makes this repo a local marketplace
docs/SPEC.md — goals, architecture, flows; read first
docs/PLAN.md — task list and status
docs/agents-plan-view-effort-chat-plan.md — the plan-first pane, effort and chat design
notes/ — discovery notes behind the spec
.claude-plugin/plugin.json — mod manifest
prompts/system.txt — user-editable system part of every agent prompt
.opencode-monitor/config.json — optional effort tier table and variant map (not committed)
hooks/hooks.json — points to the hooks module
hooks/register.tsx — wiring: hooks, timer, pane, tools, command, plan and effort injection
hooks/pane.tsx — plan list and chat render tree (pure)
hooks/plan.ts — plan validation, effort/persona inference, variants, linking and stats (pure)
hooks/mascot.ts — pixel robot SVG by effort and state (pure)
hooks/config.ts — defaults and config file loading
hooks/tracker.ts — id extraction and tracked agents (pure)
hooks/db.ts — read-only opencode database access
hooks/summary.ts — rows to AgentStatus, chat grouping and formatting (pure)
types/index.d.ts — $.state contract
tests/pane.test.tsx — pane and hook tests
tests/plan.test.ts — plan, effort, variants and stats
tests/config.test.ts — config defaults, merge and failures
tests/effort.test.ts — plan tool and agent call injection
tests/tracker.test.ts — id parsing and tracked list
tests/summary.test.ts — rows to AgentStatus and chat formatting
tests/db.test.ts — query building and failures, with a fake $
