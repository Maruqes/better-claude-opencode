import { expect, test } from 'claude-code/testing'

import { configFromText, DEFAULT_CONFIG, loadConfig } from '../hooks/config'

const reader = (options: { exists?: boolean; text?: string; readError?: Error } = {}) => ({
  fs: {
    exists: async () => options.exists ?? true,
    read: async () => {
      if (options.readError) throw options.readError

      return options.text ?? '{}'
    },
  },
  session: { root: async () => '/p' },
})

test('a missing file uses the defaults without a warning', async () => {
  expect(await loadConfig(reader({ exists: false }))).toEqual({ config: DEFAULT_CONFIG })
})

test('invalid JSON warns and keeps the defaults', async () => {
  const loaded = await loadConfig(reader({ text: '{ nope' }))

  expect(loaded.config).toEqual(DEFAULT_CONFIG)
  expect(loaded.warning).toContain('invalid JSON')
})

test('a read failure warns and keeps the defaults', async () => {
  const loaded = await loadConfig(reader({ readError: new Error('denied') }))

  expect(loaded.config).toEqual(DEFAULT_CONFIG)
  expect(loaded.warning).toBe('denied')
})

test('the effort section merges over the defaults', () => {
  const loaded = configFromText(
    JSON.stringify({
      effort: {
        enabled: false,
        table: { high: { model: 'acme/pro', variant: 'max' } },
        variants: { 'acme-pro': ['low', 'max'] },
      },
    }),
  )

  expect(loaded.warning).toBeUndefined()
  expect(loaded.config.effort.enabled).toBe(false)
  expect(loaded.config.effort.table.high).toEqual({ model: 'acme/pro', variant: 'max' })
  expect(loaded.config.effort.table.low).toEqual(DEFAULT_CONFIG.effort.table.low)
  expect(loaded.config.effort.variants['acme-pro']).toEqual(['low', 'max'])
})

test('a bad entry warns and leaves the rest in force', () => {
  const loaded = configFromText(
    JSON.stringify({
      effort: {
        enabled: 'yes',
        table: { high: { model: '', variant: 'max' }, max: { model: 'acme/max', variant: 'max' } },
        variants: { bad: 'low' },
      },
    }),
  )

  expect(loaded.warning).toContain('effort.enabled')
  expect(loaded.warning).toContain('effort.table.high')
  expect(loaded.warning).toContain('effort.variants.bad')
  expect(loaded.config.effort.enabled).toBe(true)
  expect(loaded.config.effort.table.high).toEqual(DEFAULT_CONFIG.effort.table.high)
  expect(loaded.config.effort.table.max).toEqual({ model: 'acme/max', variant: 'max' })
})

test('a non-object file warns and uses the defaults', () => {
  expect(configFromText('[]').config).toEqual(DEFAULT_CONFIG)
  expect(configFromText('[]').warning).toBe('the file must hold a JSON object')
})
