# opencode-agent-monitor

A Claude Code mod that shows the opencode subagents started from the current
session. It adds a live pane (`/opencode-agents`) with each agent's status and
progress, a plan view with personas, effort, model and dependencies, an
`opencode_status` tool Claude can call, an `opencode_plan` tool for multi-agent
jobs, and wake-ups when an agent finishes or asks a question.

## Setup

Requires `claude`, `opencode` and `sqlite3` on your PATH. The mod reads the
opencode database read-only; it never modifies agent results.

```bash
./install.sh
```

Then start a new Claude session, or run `/reload-plugins` in an open one.

## Effort and model

An `agent` call without an effort gets one from the registered plan, or from the
job's title and prompt. A missing model comes from the tier table. Claude's own
`effort` and `model` always win. Override the table, the supported variants, or
turn injection off in `.opencode-monitor/config.json`:

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

The file is optional; a missing file uses the defaults, and a broken one warns
once without blocking an agent.

See `docs/SPEC.md` for the design. Licensed under MIT.
