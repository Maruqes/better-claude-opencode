export type SessionRow = {
  id: string
  title: string
  model: string | null
  cost: number
  time_created: number
  time_updated: number
  run_started: number | null
}

// The newest message of a session.
export type MessageRow = {
  session_id: string
  role: string
  finish: string | null
  completed: number | null
  error_name: string | null
  error_message: string | null
}

// Assistant `text` and `tool` parts, newest first, without tool input or output.
export type PartRow = {
  session_id: string
  type: string
  tool: string | null
  status: string | null
  title: string | null
  text: string | null
}

export type Rows = { sessions: SessionRow[]; messages: MessageRow[]; parts: PartRow[] }

type Failure = { ok: false; error: string }
type Process = {
  process: {
    run(argv: readonly string[]): Promise<{ exitCode: number; stdout: string; stderr: string }>
  }
}

const RECENT_PARTS = 10
const EXCERPT_CHARS = 300
export const SESSION_ID = /^ses_[A-Za-z0-9]+$/

const quote = (text: string) => `'${text.replaceAll("'", "''")}'`
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export const createDb = ($: Process) => {
  let path: string | undefined

  const resolvePath = async () => {
    if (path) return path
    const { exitCode, stdout, stderr } = await $.process.run(['opencode', 'db', 'path'])
    if (exitCode !== 0 || !stdout.trim()) throw new Error(stderr.trim() || 'opencode db path failed')

    return (path = stdout.trim())
  }

  const query = async <T>(sql: string): Promise<T[]> => {
    const argv = ['sqlite3', '-readonly', '-json', await resolvePath(), sql]
    const { exitCode, stdout, stderr } = await $.process.run(argv)
    if (exitCode !== 0) throw new Error(stderr.trim() || `sqlite3 exited ${exitCode}`)

    // sqlite3 -json prints nothing at all for an empty result.
    return stdout.trim() ? JSON.parse(stdout) : []
  }

  const fetchRows = async (ids: string[]): Promise<({ ok: true } & Rows) | Failure> => {
    const bad = ids.find(id => !SESSION_ID.test(id))
    if (bad !== undefined) return { ok: false, error: `invalid session id: ${bad}` }
    if (!ids.length) return { ok: true, sessions: [], messages: [], parts: [] }

    const list = ids.map(quote).join(',')
    try {
      const [sessions, messages, parts] = await Promise.all([
        query<SessionRow>(`
          select id, title, cost, time_created, time_updated,
            json_extract(model, '$.providerID') || '/' || json_extract(model, '$.id') as model,
            (select max(time_created) from message
              where session_id = session.id and json_extract(data, '$.role') = 'user') as run_started
          from session where id in (${list})`),
        query<MessageRow>(`
          select session_id,
            json_extract(data, '$.role') as role,
            json_extract(data, '$.finish') as finish,
            json_extract(data, '$.time.completed') as completed,
            json_extract(data, '$.error.name') as error_name,
            json_extract(data, '$.error.data.message') as error_message
          from (select session_id, data, row_number() over
              (partition by session_id order by time_created desc, id desc) as n
            from message where session_id in (${list}))
          where n = 1`),
        query<PartRow>(`
          select session_id, type, tool, status, title, text
          from (select p.session_id,
              json_extract(p.data, '$.type') as type,
              json_extract(p.data, '$.tool') as tool,
              json_extract(p.data, '$.state.status') as status,
              substr(json_extract(p.data, '$.state.title'), 1, ${EXCERPT_CHARS}) as title,
              substr(json_extract(p.data, '$.text'), -${EXCERPT_CHARS}) as text,
              row_number() over
                (partition by p.session_id order by p.time_created desc, p.id desc) as n
            from part p join message m on m.id = p.message_id
            where p.session_id in (${list})
              and json_extract(m.data, '$.role') = 'assistant'
              and json_extract(p.data, '$.type') in ('text', 'tool')
              and json_extract(p.data, '$.synthetic') is not true)
          where n <= ${RECENT_PARTS}
          order by n`),
      ])

      return { ok: true, sessions, messages, parts }
    } catch (e) {
      return { ok: false, error: message(e) }
    }
  }

  const findRootSessions = async (
    directory: string,
    since: number,
  ): Promise<{ ok: true; ids: string[] } | Failure> => {
    if (!Number.isFinite(since)) return { ok: false, error: `invalid timestamp: ${since}` }

    try {
      const rows = await query<{ id: string }>(`
        select id from session
        where parent_id is null and directory = ${quote(directory)}
          and time_created >= ${Math.trunc(since)}
        order by time_created`)

      return { ok: true, ids: rows.map(r => r.id) }
    } catch (e) {
      return { ok: false, error: message(e) }
    }
  }

  return { fetchRows, findRootSessions }
}
