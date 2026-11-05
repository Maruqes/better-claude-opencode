# Pane chat UI: Grill / Discovery Notes
Date: 2026-11-05 · Goal: decide how to make the opencode agents pane, mainly the per-agent chat, look and feel better.

## Summary / key decisions
- The chat's main job is watching live: latest activity is prominent, older steps collapse into summaries.
- Tool steps group between replies: one expandable line like "6 steps: read, edit, bash"; the latest running step stays visible.
- Opening a chat takes over the whole pane, with a Back button and an agent header; other agents return on Back.
- The chat header shows the progress bar and current task; the checklist is collapsed behind a "Tasks 2/5" button.
- Messages use a clean document style: replies are plain Markdown with no boxes; the task prompt shows 3 lines with "Show more".
- When scrolled up, a "Jump to latest" button appears; pressing it returns to the bottom and resumes following.

## Q&A log

### Q1 — Chat purpose
- Asked: What is the main job of the open chat view?
- Captured: "Watch live": see at a glance what the agent is doing now; older steps collapsed into summaries.
- Flags: none

### Q2 — Tool steps
- Asked: How should older tool steps be shown?
- Captured: "Group between replies": each run of tool calls is one line with an expand button; the latest running step stays visible.
- Flags: none

### Q3 — Layout
- Asked: What should the pane show when one agent's chat is open?
- Captured: "Full-pane chat view": chat takes over the pane with Back and an agent header, so scrolling moves one conversation only.
- Flags: the pane body is one scroller, so a truly sticky header may not be possible; check in the API -> Claude

### Q4 — Task list
- Asked: Where do the task list and progress bar go in the chat view?
- Captured: "Bar on top, list collapsed": header has the bar and current task; a "Tasks 2/5" button opens the checklist.
- Flags: none

### Q5 — Messages
- Asked: How should replies and the task prompt look?
- Captured: "Clean document style": unboxed Markdown replies; the prompt is cut to 3 lines with "Show more".
- Flags: none

### Q6 — New activity
- Asked: How should the view signal new activity while scrolled up?
- Captured: "Jump to latest button": shown when scrolled up; pressing it resumes following.
- Flags: a header button scrolls out of view with the pane body, so it needs a pinned position; check whether an absolute Box can stay in the window -> Claude

## Open flags (pending input)
Both closed: a `position="absolute"` Box at `top={scroll.offset}` stays in the window, since each `ui.scroll` move redraws the pane. The header and Jump to latest use it.

## Plan (built; step 8's real-app check is still open)
1. Unblock the install: settle the old `better-claude-opencode-local` registration and the `~/.claude/skills` copy, so changes can be seen.
2. Check the two open flags in the API: can anything stay pinned while the pane body scrolls?
3. Add pane navigation: the list view, and a full-pane chat view with Back and an agent header.
4. Header: progress bar, current task, and a "Tasks 2/5" button that opens the checklist.
5. Group tool runs between replies into one expandable line; keep the latest running step visible.
6. Clean messages: unboxed Markdown replies, task prompt cut to 3 lines with "Show more".
7. Add "Jump to latest" when scrolled up.
8. Test, install, and check scrolling and appearance in the real app.
