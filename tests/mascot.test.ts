import { expect, test } from 'claude-code/testing'

import { EFFORTS } from '../hooks/config'
import { fadedTextSvg, progressSvg, robotSvg } from '../hooks/mascot'
import type { RobotState } from '../hooks/mascot'

const STATES: RobotState[] = ['planned', 'running', 'asking', 'finished', 'stopped', 'unknown']

test('every effort and state draws a small, well-formed robot', () => {
  for (const effort of EFFORTS) {
    for (const state of STATES) {
      const svg = robotSvg(effort, state)
      expect(svg.startsWith('<svg')).toBe(true)
      expect(svg.endsWith('</svg>')).toBe(true)
      expect(svg.length).toBeLessThan(1200)
    }
  }
})

test('each effort has its own look, and only live states animate', () => {
  expect(new Set(EFFORTS.map(effort => robotSvg(effort, 'planned'))).size).toBe(EFFORTS.length)
  expect(robotSvg('high', 'running')).toContain('class="rb"')
  expect(robotSvg('high', 'finished')).not.toContain('<style>')
})

test('a 50-task plan of sprites leaves room under the draw limit', () => {
  expect(robotSvg('xhigh', 'planned').length * 50).toBeLessThan(40_000)
})

test('the progress bar stays within its width at any percent', () => {
  expect(progressSvg(200, 0)).not.toContain('fill="#4C8DF0"')
  expect(progressSvg(200, 1)).toContain('<rect width="6"')
  expect(progressSvg(200, 150)).toContain('<rect width="200" height="6" rx="3" fill="#4C8DF0"')
})

test('faded text escapes the prompt and fades through a mask', () => {
  const svg = fadedTextSvg(['<b>&"x\'', ''], 200)

  expect(svg).toContain('&lt;b&gt;&amp;&quot;x&apos;')
  expect(svg).not.toContain('<b>')
  expect(svg).toContain('<mask id="m">')
  expect(svg).toContain('mask="url(#m)"')
  expect(svg).toContain('prefers-color-scheme:dark')
  expect(svg).not.toMatch(/<script|foreignObject/)
})
