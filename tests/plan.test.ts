import { expect, test } from 'claude-code/testing'

import type { AgentStatus, Plan } from '../types'
import { DEFAULT_CONFIG } from '../hooks/config'
import {
  descriptionOf,
  effortForAgent,
  formatClock,
  formatCost,
  formatPlanSet,
  formatTokens,
  inferEffort,
  inferPersona,
  linkTask,
  normalizeEffort,
  normalizePlan,
  planRows,
  planStats,
  resolvedTask,
  resolveVariant,
  taskIdOf,
  unplannedAgents,
} from '../hooks/plan'

const agent = (id: string, title: string, extra: Partial<AgentStatus> = {}): AgentStatus => ({
  id,
  title,
  model: 'opencode-go/deepseek-v4.1-flash',
  state: 'finished',
  startedAt: 1000,
  elapsedMs: 1000,
  recent: '',
  cost: 0.001,
  tokens: 100,
  ...extra,
})

const plan = (): Plan => ({
  title: 'Ride verdict',
  createdAt: 1000,
  tasks: [
    { id: 1, title: 'Scout the API', persona: 'scout', effort: 'low', after: [] },
    { id: 2, title: 'Build the engine', persona: 'builder', effort: 'high', after: [1] },
    { id: 3, title: 'Review it', persona: 'reviewer', effort: 'xhigh', after: [2] },
  ],
})

test('effort aliases normalize, and unknown text is absent', () => {
  expect(normalizeEffort('careful')).toBe('xhigh')
  expect(normalizeEffort('light')).toBe('low')
  expect(normalizeEffort('heavy')).toBe('high')
  expect(normalizeEffort('MAX')).toBe('max')
  expect(normalizeEffort('slow')).toBeUndefined()
  expect(normalizeEffort(3)).toBeUndefined()
})

test('inference reads the job, not just the title', () => {
  expect(inferEffort('Scout the API', 'read the routes')).toBe('low')
  expect(inferEffort('Review the engine')).toBe('xhigh')
  expect(inferEffort('Security overhaul')).toBe('max')
  expect(inferEffort('Fix the parser')).toBe('high')
  expect(inferEffort('Typo in the README')).toBe('minimal')
  expect(inferPersona('Scout the API')).toBe('scout')
  expect(inferPersona('Build the engine')).toBe('builder')
  expect(inferPersona('Test the parser')).toBe('tester')
  expect(inferPersona('Review the engine')).toBe('reviewer')
  expect(inferPersona('Help with the changelog')).toBe('general')
})

test('the nearest supported variant wins, and an equal distance picks the stronger', () => {
  expect(resolveVariant('medium', 'opencode-go/glm-5.3-flash', DEFAULT_CONFIG.effort.variants)).toBe('high')
  expect(resolveVariant('minimal', 'opencode-go/deepseek-v4.1-flash', DEFAULT_CONFIG.effort.variants)).toBe('low')
  expect(resolveVariant('xhigh', 'opencode-go/kimi-k3.1-pro', DEFAULT_CONFIG.effort.variants)).toBe('max')
  // low (1) and high (3) are equally far from medium (2); the stronger wins.
  expect(resolveVariant('medium', 'opencode-go/deepseek-v4.1-flash', DEFAULT_CONFIG.effort.variants)).toBe('high')
  expect(resolveVariant('medium', 'opencode-go/qwen3.8-flash', DEFAULT_CONFIG.effort.variants)).toBe('medium')
  expect(resolveVariant('high', 'someone/unknown-model', DEFAULT_CONFIG.effort.variants)).toBe('high')
})

test('the default table maps medium on glm to the high variant', () => {
  const task = { id: 1, title: 'Core', persona: 'builder' as const, effort: 'medium' as const, after: [] }

  expect(resolvedTask(task, DEFAULT_CONFIG.effort)).toEqual({
    effort: 'medium',
    model: 'opencode-go/glm-5.3-flash',
    variant: 'high',
    requested: 'medium',
  })
  expect(resolvedTask({ ...task, model: 'opencode-go/deepseek-v4-pro' }, DEFAULT_CONFIG.effort).model).toBe(
    'opencode-go/deepseek-v4-pro',
  )
})

test('the plan fills a missing effort, and an explicit choice always wins', () => {
  const stored = plan()
  const title = '2. Build the engine'

  expect(effortForAgent(stored, title, '', undefined)).toBe('high')
  expect(effortForAgent(stored, title, '', 'max')).toBe('max')
  expect(effortForAgent(stored, 'Unplanned job', 'review a security design', undefined)).toBe('max')
})

test('a numbered title links to its task; a plain title links by exact text', () => {
  const stored = plan()

  expect(taskIdOf('2. Build the engine')).toBe(2)
  expect(taskIdOf('2) Build the engine')).toBe(2)
  expect(taskIdOf('Build 2 engines')).toBeUndefined()
  expect(linkTask(stored, '3. Review it')?.id).toBe(3)
  expect(linkTask(stored, 'Build the engine')?.id).toBe(2)
  expect(linkTask(stored, 'Build the engine now')).toBeUndefined()
})

test('plan rows keep every linked agent, newest first, and hide nothing', () => {
  const stored = plan()
  const statuses = [
    agent('ses_old', '2. Build the engine', { startedAt: 1000 }),
    agent('ses_new', '2. Build the engine', { startedAt: 3000, state: 'running' }),
    agent('ses_other', 'Hotfix typo'),
  ]
  const rows = planRows(stored, statuses)

  expect(rows[1]?.agents.map(a => a.id)).toEqual(['ses_old', 'ses_new'])
  expect(rows[1]?.newest?.id).toBe('ses_new')
  expect(unplannedAgents(stored, statuses).map(a => a.id)).toEqual(['ses_other'])
})

test('plan stats include linked and post-plan agents, and freeze when all settle', () => {
  const stored = plan()
  const statuses = [
    agent('ses_a', '1. Scout the API', { startedAt: 1000, elapsedMs: 1000, cost: 0.001, tokens: 100 }),
    agent('ses_b', '2. Build the engine', { startedAt: 1200, elapsedMs: 800, cost: 0.002, tokens: 200 }),
    agent('ses_old', 'Old work', { startedAt: 10, elapsedMs: 5, cost: 9, tokens: 9 }),
    agent('ses_after', 'Unplanned after', { startedAt: 5000, elapsedMs: 1000, cost: 0.003, tokens: 300 }),
  ]

  expect(planStats(stored, statuses, 9000)).toEqual({
    cost: 0.006,
    tokens: 600,
    elapsedMs: 5000,
    done: 2,
    total: 3,
    isSettled: true,
  })
  expect(planStats(stored, statuses.map(a => ({ ...a, state: 'running' as const })), 7000).elapsedMs).toBe(6000)
  expect(planStats(stored, [], 9000)).toMatchObject({ cost: 0, tokens: 0, elapsedMs: 0, done: 0 })
})

test('plan normalization fills ids, infers fields and rejects bad edges', () => {
  const ok = normalizePlan(
    {
      title: '  Ride   verdict  ',
      tasks: [
        { title: ' Scout ', after: [2] },
        { title: 'Build', persona: 'builder', effort: 'careful' },
      ],
    },
    5000,
  )

  expect(ok.ok).toBe(true)
  if (!ok.ok) return
  expect(ok.plan.title).toBe('Ride verdict')
  expect(ok.plan.createdAt).toBe(5000)
  expect(ok.plan.tasks.map(t => [t.id, t.persona, t.effort])).toEqual([
    [1, 'scout', 'low'],
    [2, 'builder', 'xhigh'],
  ])

  expect(normalizePlan({ tasks: [] }, 1).ok).toBe(false)
  expect(normalizePlan({ tasks: [{ id: 1, title: 'A' }, { id: 1, title: 'B' }] }, 1).ok).toBe(false)
  expect(normalizePlan({ tasks: [{ id: 0, title: 'A' }] }, 1).ok).toBe(false)
  expect(normalizePlan({ tasks: [{ id: 1, title: 'A', after: [1] }] }, 1).ok).toBe(false)
  expect(normalizePlan({ tasks: [{ id: 1, title: 'A', after: [2] }] }, 1).ok).toBe(false)
  expect(normalizePlan({ tasks: [{ title: ' ' }] }, 1).ok).toBe(false)
  expect(normalizePlan({ tasks: Array.from({ length: 51 }, () => ({ title: 'x' })) }, 1).ok).toBe(false)
})

test('plan titles and descriptions are capped and readable', () => {
  const ok = normalizePlan({ title: 'x'.repeat(200), tasks: [{ title: 'y'.repeat(200) }] }, 1)
  expect(ok.ok).toBe(true)
  if (!ok.ok) return
  expect(ok.plan.title.length).toBe(80)
  expect(ok.plan.tasks[0]!.title.length).toBe(120)
  expect(descriptionOf(ok.plan.tasks[0]!)).toBe(`1. ${'y'.repeat(119)}…`)
})

test('the tool table lists resolved values and the exact description', () => {
  const text = formatPlanSet(plan(), DEFAULT_CONFIG.effort)

  expect(text).toContain('Plan: Ride verdict')
  expect(text).toContain('1. Scout the API')
  expect(text).toContain('scout · low · opencode-go/deepseek-v4.1-flash · low')
  expect(text).toContain('description: "2. Build the engine"')
  expect(text).toContain('after 1')
})

test('the compact figures stay stable at zero and small values', () => {
  expect(formatTokens(0)).toBe('0')
  expect(formatTokens(999)).toBe('999')
  expect(formatTokens(12400)).toBe('12.4k')
  expect(formatTokens(1_200_000)).toBe('1.2M')
  expect(formatCost(0)).toBe('≈$0.00')
  expect(formatCost(0.0042)).toBe('≈$0.0042')
  expect(formatCost(1.2)).toBe('≈$1.20')
  expect(formatClock(0)).toBe('0:00')
  expect(formatClock(42_000)).toBe('0:42')
  expect(formatClock(3_720_000)).toBe('1:02:00')
})
