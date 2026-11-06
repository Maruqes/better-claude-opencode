// Dev preview: renders hooks/pane.tsx with sample data into HTML. Run: bun preview/serve.ts, open :4173
import { renderPane } from '../hooks/pane'
import { DEFAULT_CONFIG } from '../hooks/config'

const COLORS: Record<string, string> = { suggestion: '#7aa2f7', success: '#9ece6a', warning: '#e0af68', error: '#f7768e', subtle: '#565f89', inactive: '#565f89', yellow: '#e0af68' }
const esc = (s: unknown) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
const px = (v: unknown, unit = 8) => (typeof v === 'number' ? `${v * unit}px` : String(v))

function html(n: any): string {
  if (n == null || n === false || n === true) return ''
  if (Array.isArray(n)) return n.map(html).join('')
  if (typeof n !== 'object') return esc(n)
  const { type, props: p } = n
  const kids = html(p.children)
  if (type === 'Fragment') return kids
  const st: string[] = []
  const color = p.color && (COLORS[p.color] ?? p.color)
  if (color) st.push(`color:${color}`)
  if (p.dimColor) st.push('opacity:.55')
  if (p.bold) st.push('font-weight:700')
  if (p.italic) st.push('font-style:italic')
  if (type === 'Box') {
    st.push('display:flex', `flex-direction:${p.flexDirection ?? 'column'}`)
    for (const [k, css] of [['gap', 'gap'], ['columnGap', 'column-gap'], ['rowGap', 'row-gap'], ['paddingLeft', 'padding-left'], ['paddingX', ''], ['marginTop', 'margin-top'], ['flexGrow', 'flex-grow'], ['flexShrink', 'flex-shrink'], ['width', 'width'], ['height', 'height'], ['minWidth', 'min-width'], ['overflow', 'overflow'], ['alignItems', 'align-items'], ['justifyContent', 'justify-content']] as const) {
      if (p[k] === undefined) continue
      if (k === 'paddingX') st.push(`padding-left:${px(p[k])}`, `padding-right:${px(p[k])}`)
      else st.push(`${css}:${['flexGrow', 'flexShrink'].includes(k) ? p[k] : k === 'height' && typeof p[k] === 'number' ? `${p[k] * 16}px` : px(p[k])}`)
    }
    if (p.backgroundColor) st.push(`background:${COLORS[p.backgroundColor] ?? p.backgroundColor}`)
    return `<div style="${st.join(';')}">${kids}</div>`
  }
  if (type === 'Text') {
    if (p.wrap === 'truncate-end') st.push('overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block')
    return `<span style="${st.join(';')};white-space:${p.wrap === 'wrap' ? 'pre-wrap' : 'pre'}">${kids}</span>`
  }
  if (type === 'Button') return `<button style="${st.join(';')}" class="${p.plain ? 'plain' : ''}">${esc(p.label)}</button>`
  if (type === 'Svg') return `<img alt="${esc(p.alt ?? '')}" width="${p.width}" height="${p.height}" src="data:image/svg+xml;utf8,${encodeURIComponent(p.source)}">`
  if (type === 'Markdown') return `<div style="white-space:pre-wrap">${esc(p.text)}</div>`
  if (type === 'Code') return `<pre class="code">${esc(p.source)}</pre>`
  return `<div data-unknown="${esc(type)}">${kids}</div>`
}

const now = 1_700_000_000_000
const agent = (id: string, state: string, extra = {}) => ({ id, title: `${id} task`, model: 'deepseek-flash', variant: 'high', state, startedAt: now, elapsedMs: 72000, recent: 'running pytest', cost: 0.004, tokens: 1200, ...extra })
const statuses: any[] = [
  agent('1. Map the code', 'finished'),
  agent('2. Build the pane', 'running', { currentTool: 'bash', tasks: [{ content: 'Read files', status: 'completed' }, { content: 'Edit pane', status: 'in_progress' }, { content: 'Run tests', status: 'pending' }] }),
  agent('3. Review', 'asking', { question: 'QUESTION: keep it?\n1. yes\n2. no' }),
]
const plan = { title: 'Pane polish', createdAt: now, tasks: [
  { id: 1, title: 'Map the code', persona: 'scout', effort: 'low', after: [] },
  { id: 2, title: 'Build the pane', persona: 'builder', effort: 'high', after: [1] },
  { id: 3, title: 'Review', persona: 'reviewer', effort: 'medium', after: [2] },
] }
const entries: any[] = [
  { kind: 'prompt', text: '# Task\n1. Edit the pane\n2. Run tests', id: 'p' },
  { kind: 'reasoning', text: 'Thinking about the layout\nand the colours', id: 'r1', messageId: 'm1' },
  { kind: 'tool', text: 'bash', detail: 'bun test', output: 'ok 12 tests\nall passed', id: 't1', messageId: 'm1' },
  { kind: 'reply', text: 'Done: **pane** edited.', id: 'a1', messageId: 'm1', tokens: 900, cost: 0.002, timeCreated: now, timeCompleted: now + 12000 },
]

const server = Bun.serve({
  port: 4173,
  async fetch(req) {
    const q = new URL(req.url).searchParams
    const surface = q.get('surface') ?? 'desktop'
    const open = q.get('open') ?? ''
    const ui = Object.fromEntries(['Box', 'Text', 'Button', 'Markdown', 'Code', 'Svg'].map(t => [t, t]))
    const $: any = { ui: { resolve: () => ui } }
    const e = { surface, props: { bodyColumns: Number(q.get('cols') ?? 60), scroll: { offset: 0, bodyRows: 30 }, placement: 'dock', title: 'opencode agents' } }
    const noop = async () => {}
    const ctx: any = { statuses, warning: '', stopError: '', openAgent: open, prompts: ['2. Build the pane'], history: { id: open, entries, total: entries.length }, chatView: { isTasksOpen: false, expanded: [] }, plan: q.get('plan') === '0' ? null : plan, planView: { isCollapsed: false }, isFollowing: true, effort: DEFAULT_CONFIG.effort, openChat: noop, stop: noop, back: noop, jump: noop, toggleTasks: noop, toggle: noop, clearPlan: noop, togglePlan: noop }
    const tree = await renderPane($, e, ctx)
    const body = `<body style="background:#1a1b26;color:#c0caf5;font:14px/1.4 ui-monospace,monospace;margin:0;padding:12px;width:${e.props.bodyColumns * 8}px"><style>button{font:inherit;color:inherit;background:#33467c;border:0;padding:2px 8px;border-radius:4px}button.plain{background:none;padding:0}.code{margin:0;background:#16161e;padding:4px}</style>${html(tree)}</body>`
    return new Response(`<!doctype html><meta charset=utf-8>${body}`, { headers: { 'content-type': 'text/html' } })
  },
})
console.log(`preview on http://localhost:${server.port}  (?surface=desktop|terminal&open=<agent id>&plan=0)`)
