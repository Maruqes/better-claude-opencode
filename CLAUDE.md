Stack: Claude Code mod (TSX hooks module, no npm dependencies); repo root is the plugin root.

Commands:
- Validate: `claude plugin validate .`
- Test: `claude plugin test .`
- Types: `tsc -p .`

Conventions:
- The module has no Node or DOM: everything external goes through `$`.
- Keep parsing and state logic pure in `hooks/tracker.ts` and `hooks/summary.ts`, so it is testable.
- Open the opencode database read-only, and find it with `opencode db path`, never a hardcoded path.
- Database failures are values shown as a pane warning; never throw from a hook because of them.
- Never change MCP behaviour: read results, do not rewrite them.

See `docs/SPEC.md`, `docs/PLAN.md`, `filemap.md`.
