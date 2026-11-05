# Agents pane polish: Grill / Discovery Notes
Date: 2026-11-05 · Goal: settle the agent icon, automatic per-task effort, and a better per-agent chat, then update the plan.

## Summary / key decisions
- Icon: a new original pixel mascot for this mod, costume per effort tier, gently animated while running; desktop uses Svg, terminal keeps text.
- Effort: Claude rates every task from a short rubric in the opencode_plan instructions; keyword inference only fills gaps.
- Chat: keep the structure, polish the look: mascot header, spacing, distinct prompt/reply/tool styles, tidier tool rows and diffs.
- Mascot: a little boxy pixel robot; effort shown as its headgear.
- Install: remove the old registration and reinstall before Sprint 1, so live checks happen early.

## Q&A log

### Q1 — Icon style
- Asked: What should each agent's icon be?
- Captured: "Own pixel mascot": original character, costume per effort tier, as in the screenshot; replaces persona emoji on desktop.
- Flags: none

### Q2 — Effort owner
- Asked: Who should normally choose each task's effort?
- Captured: "Claude, keywords as backup": rubric in the instructions; existing inference stays as the fallback; no reason text in the pane.
- Flags: none

### Q3 — Chat focus
- Asked: What feels most wrong in the open chat?
- Captured: "Looks plain, needs polish": structure stays; visual work only.
- Flags: none

### Q4 — Mascot
- Asked: Which original creature?
- Captured: "Little robot".
- Flags: none

### Q5 — Install timing
- Asked: When to remove better-claude-opencode-local and reinstall?
- Captured: "Before Sprint 1". This replaces the earlier "Not now".
- Flags: none

## Open flags (pending input)
None.
