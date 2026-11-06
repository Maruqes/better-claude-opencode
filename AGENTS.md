# opencode-agent-monitor

A Claude Code mod that shows the opencode subagents started from the current session: a live pane, an `opencode_status` tool, and a one-time wake of Claude when an agent finishes or asks a question. The repo keeps the older name `better-claude-opencode`.

Stack: Claude Code mod (TSX hooks module, no npm dependencies); repo root is the plugin root.

## Knowledge

SilverBullet is the project knowledge base. Start at `knowledge/projects/better-claude-opencode/index`, through the SilverBullet MCP, and read the relevant pages before working. If a page and the code disagree, the code wins: fix the page.

Every project update must also update SilverBullet. In the same task, change the canonical page for any behaviour, contract, decision, command or status that changed, and refresh its `reviewed_on`, `source_commit` and `sources`. Keep one home per fact, and save no routine progress, logs or secrets.

## Commands

- Validate: `claude plugin validate .`
- Test: `claude plugin test .`
- Types: `tsc -p .`
- Install or update: `./install.sh`

## Seeing the pane

`preview/serve.ts` renders the real `hooks/pane.tsx` as HTML with sample data, so you can look at a UI change instead of guessing.

1. Run `bun --tsconfig-override preview/tsconfig.json preview/serve.ts` (port 4173; restart it after editing the pane).
2. Open it in the built-in browser (`mcp__Claude_Browser__*`) and take a screenshot. Options go in the URL: `?surface=desktop|terminal`, `&open=<agent title>` for the chat, `&plan=0` for no plan, `&cols=40`.
3. Edit the sample data in `serve.ts` to reproduce a state (asking, stopped, long text, many tasks).
4. Behaviour (presses, state, Stop) is tested with `claude plugin test .`, not here: the preview's buttons do nothing.

The preview is an approximation: its colours, spacing and element mapping are guesses, not Claude Code's real renderer. Trust it for structure and layout, not pixels. After a visual change, ask the user how the real pane differs from the preview, and ask for a screenshot of the real pane (terminal or Desktop) next to it. A screenshot beats a description. Then fix `serve.ts` too if it was wrong.

## Rules

- The module has no Node or DOM: everything external goes through `$`.
- Keep parsing and state logic pure in `hooks/tracker.ts` and `hooks/summary.ts`, so it is testable.
- Open the opencode database read-only, and find it with `opencode db path`, never a hardcoded path.
- Database failures are values shown as a pane warning; never throw from a hook because of them.
- Never change MCP behaviour: read results, do not rewrite them.
- Write code, docs and knowledge in English.

See `docs/SPEC.md`, `docs/PLAN.md`, `filemap.md`.
