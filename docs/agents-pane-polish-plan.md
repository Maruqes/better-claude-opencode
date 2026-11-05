# Plan: Agents pane polish (robot mascot, automatic effort, better chat)

**Generated**: 2026-11-05
**Estimated complexity**: Medium
**Decisions**: `notes/2026-11-05-agents-pane-polish-grill.md`

## Overview

The plan view, effort resolution and rich chat turns from `docs/agents-plan-view-effort-chat-plan.md` already exist. This plan adds only what is missing:

- An original pixel robot on every plan row, agent row and chat header. Its headgear shows the effort tier.
- A rubric so Claude rates every task. Keyword inference stays as the fallback.
- A visual pass on the open chat. Its structure does not change.

Desktop draws through the engine's `Svg` element. Terminal keeps the bracketed text glyphs. No new dependencies, and MCP behaviour does not change.

## Prerequisites

- `tsc -p .` is clean: fix the `ChatItem` errors in `hooks/register.tsx` and add `tsconfig.json` if it is still missing.
- Before Sprint 1 (user approved): remove the old `better-claude-opencode-local` registration, rerun `./install.sh`, and check with `/reload-plugins`.

## Sprint 1: Robot mascot

**Goal**: rows show the robot, with headgear by effort.
**Demo/Validation**: `claude plugin test .`; a preview page of all six tiers looks right in light and dark.

### Task 1.1: Sprite module
- **Location**: `hooks/mascot.ts` (new), `tests/mascot.test.ts` (new)
- **Description**: Pure `robotSvg(effort, state)` returns an SVG string, drawn from character-grid rows on a small pixel grid, about 40x40 px. Headgear: minimal none, low cap, medium headband, high hard hat, xhigh goggles and hard hat, max crown. Tier colours match the effort label.
- **States**: planned is dimmed; running blinks the antenna with CSS, disabled under `prefers-reduced-motion`; asking shows a `?`; finished is still; stopped is grey.
- **Dependencies**: none
- **Acceptance Criteria**: original art, nothing traced from other sprites; valid SVG for all 6 x 5 combinations; each string is small; ids are not shared between SVGs on one page.
- **Validation**: unit test over every combination.

### Task 1.2: Show the robot in the pane
- **Location**: `hooks/pane.tsx`, `tests/pane.test.tsx`
- **Description**: Add `avatar(effort, state)`. When the surface is not terminal and `'Svg' in ui`, it returns `<Svg>` with a useful `alt`; otherwise it returns the current text glyph. Use it on plan rows, unplanned rows and the chat header. Remove the emoji map. Keep `persona` in the data, since the terminal glyph and plan output use it.
- **Dependencies**: 1.1
- **Acceptance Criteria**: the terminal output is unchanged; effort is coloured in the meta line, as in the screenshot; agents without a plan task use the effort from their variant, or inference.
- **Validation**: pane tests for both surfaces. The terminal's `Svg` draws nothing, so test the surface as well as the key.

## Sprint 2: Automatic effort

**Goal**: every planned task carries a deliberate effort.
**Demo/Validation**: a plan call with no efforts still resolves; the injected instructions contain the rubric.

### Task 2.1: Rubric
- **Location**: `hooks/register.tsx`, `tests/effort.test.ts`
- **Description**: In the planning instructions and the `opencode_plan` schema text, ask Claude to set effort on every task: minimal/low for mechanical edits, medium for standard features, high for delicate multi-file work, xhigh for messy or unfamiliar code, max only for very hard problems. Explicit values still win.
- **Dependencies**: none
- **Acceptance Criteria**: `normalizePlan` and `effortForAgent` are untouched; a missing effort still falls back to inference.
- **Validation**: test the prompt text and the fallback.

## Sprint 3: Chat polish

**Goal**: the open chat looks like a finished product. Use `/ui-ux-pro-max` for guidance.
**Demo/Validation**: open a finished and a running agent on desktop at normal and narrow widths.

### Task 3.1: Header
- **Location**: `hooks/pane.tsx`
- **Description**: Robot beside the title, coloured effort and a tidy meta line, then progress. The pinned header stays opaque.
- **Dependencies**: 1.2

### Task 3.2: Message styles
- **Location**: `hooks/pane.tsx`
- **Description**: Consistent vertical rhythm. Prompt is a tinted block with a "Task" label; replies stay unboxed Markdown; turn metrics become a quiet divider.
- **Dependencies**: none

### Task 3.3: Tool rows and diffs
- **Location**: `hooks/pane.tsx`, `tests/pane.test.tsx`
- **Description**: Aligned status glyph, tool name and target; output indented and dim; added and removed diff lines coloured instead of plain code. Keep the output, diff and 15,000-character limits.
- **Dependencies**: 3.2
- **Acceptance Criteria**: grouping, Jump to latest, Show more and expanded state still work; terminal stays readable.
- **Validation**: updated pane tests.

## Sprint 4: Ship

### Task 4.1: Verify and document
- **Location**: `docs/SPEC.md`, `filemap.md`, `README.md`, SilverBullet feature and decision pages
- **Description**: Run validate, test and `tsc -p .`. Reinstall and check with a real plan of agents. Update the canonical pages and their `reviewed_on`, `source_commit` and `sources`.
- **Dependencies**: all

## Testing Strategy

- Unit: sprite combinations, rubric text, effort fallback.
- Pane: desktop and terminal rendering.
- Live: Svg size in rows, animation, light and dark themes, scrolling.

## Potential Risks & Gotchas

- The pane has a 100k-character draw limit. Up to 50 inline SVGs add to it, so build sprites from merged rects and test a 50-task plan.
- `Svg` inside a row with wrapping may size differently from savvy's full-width use; check live early.
- Animation restarts if a poll redraws the SVG. If it looks jumpy, animate only the antenna or drop it.
- All uncommitted work shares this tree, so commit the existing work first to keep this diff reviewable.

## Rollback Plan

Each sprint is its own commit. Reverting Sprint 1 restores the text glyphs, with no data or state change.
