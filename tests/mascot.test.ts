import { expect, test } from 'claude-code/testing'

import { EFFORTS } from '../hooks/config'
import { robotSvg } from '../hooks/mascot'
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
