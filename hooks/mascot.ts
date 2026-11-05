import type { AgentState, Effort } from '../types'

export type RobotState = AgentState | 'planned'

type Rect = [x: number, y: number, w: number, h: number]

const STEEL = '#8FA3B8'
const GREY = '#7C7F85'
const INK = '#1E2329'
const GOLD = '#E8B93C'

const TIER: Record<Effort, string> = {
  minimal: '#9AA4AE',
  low: '#3FB27F',
  medium: '#4C8DF0',
  high: '#E8953C',
  xhigh: '#E8603C',
  max: GOLD,
}
const TIP: Record<RobotState, string> = {
  planned: GREY,
  running: '#3FB27F',
  asking: GOLD,
  finished: '#3FB27F',
  stopped: '#D9534F',
  unknown: GREY,
}

const HARD_HAT: Rect[] = [[4, 2, 8, 3], [2, 4, 12, 1]]
const HEADGEAR: Record<Effort, Rect[]> = {
  minimal: [],
  low: [[4, 3, 8, 2], [12, 4, 3, 1]],
  medium: [[3, 5, 10, 1], [13, 5, 2, 2]],
  high: HARD_HAT,
  xhigh: [...HARD_HAT, [4, 6, 8, 4]],
  max: [[4, 3, 8, 2], [4, 2, 1, 1], [11, 2, 1, 1]],
}

// One path per colour keeps a sprite under 1 KB, since a plan can draw 50 of them.
const path = (fill: string, rects: Rect[]) =>
  rects.length ? `<path fill="${fill}" d="${rects.map(([x, y, w, h]) => `M${x} ${y}h${w}v${h}h-${w}z`).join('')}"/>` : ''

// An original pixel robot on a 16x16 grid. Its headgear is the effort, its antenna the state.
export const robotSvg = (effort: Effort, state: RobotState, size = 32): string => {
  const isLive = state === 'running' || state === 'asking'
  const body = state === 'stopped' || state === 'unknown' ? GREY : STEEL
  const mouth: Rect[] = state === 'finished' ? [[5, 10, 1, 1], [6, 11, 4, 1], [10, 10, 1, 1]] : [[6, 11, 4, 1]]
  const style = isLive
    ? '<style>@keyframes rb{50%{opacity:.25}}.rb{animation:rb 1.4s steps(2) infinite}@media (prefers-reduced-motion:reduce){.rb{animation:none}}</style>'
    : ''

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16" shape-rendering="crispEdges">${style}` +
    `<g${state === 'planned' ? ' opacity=".6"' : ''}>` +
    path(body, [[7, 2, 2, 3], [3, 5, 10, 8], [2, 7, 1, 3], [13, 7, 1, 3], [5, 13, 6, 1], [5, 14, 2, 2], [9, 14, 2, 2]]) +
    path(TIER[effort], HEADGEAR[effort]) +
    path(INK, [[5, 7, 2, 2], [9, 7, 2, 2], ...mouth]) +
    `<path${isLive ? ' class="rb"' : ''} fill="${TIP[state]}" d="M7 0h2v2h-2z"/>` +
    '</g></svg>'
  )
}

// A slim rounded bar; the fill never gets narrower than its own round cap.
// Empty pixels above the bar: a Box margin could only move it a whole text row.
export const PROGRESS_TOP = 3

export const progressSvg = (width: number, percent: number, height = 6): string => {
  const fill = percent > 0 ? Math.max(height, Math.round((width * Math.min(percent, 100)) / 100)) : 0

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + PROGRESS_TOP}" viewBox="0 0 ${width} ${height + PROGRESS_TOP}">` +
    `<rect width="${width}" height="${height}" rx="${height / 2}" fill="#8A8F98" fill-opacity=".28" y="${PROGRESS_TOP}"/>` +
    (fill ? `<rect width="${fill}" height="${height}" rx="${height / 2}" fill="${TIER.medium}" y="${PROGRESS_TOP}"/>` : '') +
    '</svg>'
  )
}

const escapeXml = (text: string) =>
  text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] as string)

// Text rows that dissolve to transparent at the bottom: a luminance mask, so no theme background is needed.
// shortcut: colours follow prefers-color-scheme only, not the app theme, and the text is not selectable; upgrade if themes can be read.
export const fadedTextSvg = (rows: string[], width: number, rowHeight = 18): string => {
  const height = rows.length * rowHeight
  const lines = rows
    .map((row, n) => `<text x="0" y="${n * rowHeight + rowHeight - 5}" xml:space="preserve">${escapeXml(row)}</text>`)
    .join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    '<style>text{font:13px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;fill:#3B4048}' +
    '@media (prefers-color-scheme:dark){text{fill:#D4D7DC}}</style>' +
    '<defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#fff"/><stop offset=".4" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>' +
    `<mask id="m"><rect width="${width}" height="${height}" fill="url(#fade)"/></mask></defs>` +
    `<g mask="url(#m)">${lines}</g></svg>`
  )
}
