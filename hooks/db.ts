export type SessionRow = {
  id: string
  title: string
  model: string | null
  // opencode's model variant; `null` when it is the model's default.
  variant: string | null
  cost: number
  tokens_input: number
  tokens_output: number
  tokens_reasoning: number
  tokens_cache_read: number
  tokens_cache_write: number
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
  // The end of the message's last text part, long enough to hold a whole question.
  last_text?: string | null
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

// A todo written by opencode's `todowrite`, in list order.
export type TodoRow = { session_id: string; content: string; status: string }

// One entry of an agent's log, newest first; `total` counts all its entries.
export type HistoryRow = {
  message_id: string
  part_id: string
  role: string
  type: string
  tool: string | null
  status: string | null
  title: string | null
  text: string | null
  // Bounded tool output and edit diff, so one turn cannot blow the pane's draw limit.
  output: string | null
  diff: string | null
  // Message-level figures, repeated on each of its parts.
  tokens: number | null
  cost: number | null
  time_created: number | null
  time_completed: number | null
  total: number
}

// One text part of an agent's conversation, oldest first. User parts are whole.
export type PromptRow = { message_id: string; role: string; text: string; time_created: number }

export type Rows = { sessions: SessionRow[]; messages: MessageRow[]; parts: PartRow[]; todos: TodoRow[] }

type Failure = { ok: false; error: string }
type Process = {
  process: {
    run(argv: readonly string[]): Promise<{ exitCode: number; stdout: string; stderr: string }>
  }
}

const RECENT_PARTS = 10
const EXCERPT_CHARS = 300
const QUESTION_CHARS = 4000
// 100 x 800 stays under the 100,000 characters a pane draws.
const HISTORY_PARTS = 100
export const HISTORY_CHARS = 800
// Each tool detail is bounded here, and the pane keeps an overall detail budget.
export const OUTPUT_CHARS = 2000
export const DIFF_CHARS = 4000
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
    if (!ids.length) return { ok: true, sessions: [], messages: [], parts: [], todos: [] }

    const list = ids.map(quote).join(',')
    try {
      const [sessions, messages, parts, todos] = await Promise.all([
        query<SessionRow>(`
          select id, title, cost, time_created, time_updated,
            tokens_input, tokens_output, tokens_reasoning,
            tokens_cache_read, tokens_cache_write,
            json_extract(model, '$.providerID') || '/' || json_extract(model, '$.id') as model,
            nullif(json_extract(model, '$.variant'), 'default') as variant,
            (select max(time_created) from message
              where session_id = session.id and json_extract(data, '$.role') = 'user') as run_started
          from session where id in (${list})`),
        query<MessageRow>(`
          select session_id,
            json_extract(data, '$.role') as role,
            json_extract(data, '$.finish') as finish,
            json_extract(data, '$.time.completed') as completed,
            json_extract(data, '$.error.name') as error_name,
            json_extract(data, '$.error.data.message') as error_message,
            (select substr(json_extract(p.data, '$.text'), -${QUESTION_CHARS}) from part p
              where p.message_id = latest.id
                and json_extract(p.data, '$.type') = 'text'
                and json_extract(p.data, '$.synthetic') is not true
              order by p.time_created desc, p.id desc limit 1) as last_text
          from (select id, session_id, data, row_number() over
              (partition by session_id order by time_created desc, id desc) as n
            from message where session_id in (${list})) latest
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
        query<TodoRow>(`
          select session_id, content, status from todo
          where session_id in (${list}) order by position`),
      ])

      return { ok: true, sessions, messages, parts, todos }
    } catch (e) {
      return { ok: false, error: message(e) }
    }
  }

  const fetchHistory = async (id: string): Promise<{ ok: true; rows: HistoryRow[] } | Failure> => {
    if (!SESSION_ID.test(id)) return { ok: false, error: `invalid session id: ${id}` }

    try {
      const rows = await query<HistoryRow>(`
        select message_id, part_id, role, type, tool, status, title, text, output, diff,
          tokens, cost, time_created, time_completed, total
        from (select m.id as message_id,
            p.id as part_id,
            json_extract(m.data, '$.role') as role,
            json_extract(p.data, '$.type') as type,
            json_extract(p.data, '$.tool') as tool,
            json_extract(p.data, '$.state.status') as status,
            substr(json_extract(p.data, '$.state.title'), 1, ${EXCERPT_CHARS}) as title,
            -- a user prompt is shown whole; only replies are cut
            case when json_extract(m.data, '$.role') = 'user' then json_extract(p.data, '$.text')
              else substr(json_extract(p.data, '$.text'), 1, ${HISTORY_CHARS}) end as text,
            substr(json_extract(p.data, '$.state.output'), 1, ${OUTPUT_CHARS}) as output,
            substr(json_extract(p.data, '$.state.metadata.diff'), 1, ${DIFF_CHARS}) as diff,
            json_extract(m.data, '$.tokens.total') as tokens,
            json_extract(m.data, '$.cost') as cost,
            m.time_created as time_created,
            json_extract(m.data, '$.time.completed') as time_completed,
            count(*) over () as total,
            row_number() over (order by p.time_created desc, p.id desc) as n
          from part p join message m on m.id = p.message_id
          where p.session_id = ${quote(id)}
            and json_extract(p.data, '$.type') in ('text', 'tool', 'reasoning')
            and json_extract(p.data, '$.synthetic') is not true)
        where n <= ${HISTORY_PARTS}
        order by n`)

      return { ok: true, rows }
    } catch (e) {
      return { ok: false, error: message(e) }
    }
  }

  const fetchPrompts = async (id: string): Promise<{ ok: true; rows: PromptRow[] } | Failure> => {
    if (!SESSION_ID.test(id)) return { ok: false, error: `invalid session id: ${id}` }

    try {
      const rows = await query<PromptRow>(`
        select m.id as message_id, m.time_created,
          json_extract(m.data, '$.role') as role,
          case when json_extract(m.data, '$.role') = 'user' then json_extract(p.data, '$.text')
            else substr(json_extract(p.data, '$.text'), -${QUESTION_CHARS}) end as text
        from part p join message m on m.id = p.message_id
        where p.session_id = ${quote(id)}
          and json_extract(p.data, '$.type') = 'text'
          and json_extract(p.data, '$.synthetic') is not true
        order by m.time_created, m.id, p.time_created, p.id`)

      return { ok: true, rows }
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

  return { fetchRows, fetchHistory, fetchPrompts, findRootSessions }
}
