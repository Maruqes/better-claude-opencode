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
