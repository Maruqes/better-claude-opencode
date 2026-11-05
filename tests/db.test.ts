import { expect, test } from 'claude-code/testing'
import { createDb } from '../hooks/db'

const fake = (stdout = '[]', exitCode = 0) => {
  const calls: (readonly string[])[] = []
  const run = async (argv: readonly string[]) => {
    calls.push(argv)
    return argv[0] === 'opencode'
      ? { exitCode: 0, stdout: '/data/oc.db\n', stderr: '' }
      : { exitCode, stdout, stderr: exitCode ? 'boom' : '' }
  }

  return { calls, db: createDb({ process: { run } }) }
}

test('resolves the path once and opens it read-only', async () => {
  const { calls, db } = fake('[{"id":"ses_a"}]')

  expect(await db.findRootSessions('/p', 5)).toEqual({ ok: true, ids: ['ses_a'] })
  await db.findRootSessions('/p', 5)
  expect(calls.filter(c => c[0] === 'opencode').length).toBe(1)
  expect(calls[1]?.slice(0, 4)).toEqual(['sqlite3', '-readonly', '-json', '/data/oc.db'])
})

test('quotes the directory', async () => {
  const { calls, db } = fake('')

  expect(await db.findRootSessions("/it's", 5.5)).toEqual({ ok: true, ids: [] })
  expect(calls[1]?.[4]).toContain("directory = '/it''s'")
  expect(calls[1]?.[4]).toContain('time_created >= 5\n')
})

test('rejects bad session ids before running anything', async () => {
  const { calls, db } = fake()
  const result = await db.fetchRows(['ses_ok', "ses_x' or 1=1 --"])

  expect(result.ok).toBe(false)
  expect(calls.length).toBe(0)
})

test('failures are values', async () => {
  expect((await fake('', 1).db.fetchRows(['ses_a'])).ok).toBe(false)
  expect((await fake('not json').db.findRootSessions('/p', 1)).ok).toBe(false)

  const run = async () => {
    throw new Error('cannot start')
  }
  expect(await createDb({ process: { run } }).fetchRows(['ses_a'])).toEqual({ ok: false, error: 'cannot start' })
})
