import { listConversations, ensureLoaded } from '../conversations.js'

// Agent access to the operator's past chat sessions. Everything stays local:
// it reads the same sessions/ store the web UI uses. No network.
//
// NOTE: slugify below duplicates lib/slug.js (client side) so the model can
// link into specific headings of stored sessions. Keep the two in sync.
function slugify(text) {
  const s = String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .trim()
    .replace(/ +/g, '-')
  return s || 'section'
}

export { slugify }

const SNIPPET_PAD = 120
const LINE_CAP = 2000
const PAYLOAD_CAP = 12000
const LIMIT_DEFAULT = 10
const LIMIT_MAX = 20

function snippetAround(text, idx, qLen) {
  const start = Math.max(0, idx - SNIPPET_PAD)
  const end = Math.min(text.length, idx + qLen + SNIPPET_PAD)
  const core = text.slice(start, end).replace(/\s+/g, ' ').trim()
  return (start > 0 ? '…' : '') + core + (end < text.length ? '…' : '')
}

/** One entry per conversation — the earliest match (smallest ts) wins. */
function searchResults(query, limit) {
  const q = String(query || '').trim().toLowerCase()
  if (q.length < 3) return { count: 0, results: [], error: 'query must be at least 3 characters' }
  const lim = Math.min(Math.max(1, Number(limit) || LIMIT_DEFAULT), LIMIT_MAX)
  const best = new Map() // id -> match with the smallest ts
  const consider = (conv, role, text, ts) => {
    const full = String(text || '')
    const idx = full.toLowerCase().indexOf(q)
    if (idx < 0) return
    const cand = {
      id: conv.id,
      title: conv.title,
      role,
      ts: ts || 0,
      snippet: snippetAround(full, idx, q.length),
      link: `/chat/${conv.id}`,
    }
    const cur = best.get(conv.id)
    if (!cur || cand.ts < cur.ts) best.set(conv.id, cand)
  }
  for (const meta of listConversations()) {
    const conv = ensureLoaded(meta.id)
    if (!conv) continue
    consider(conv, 'title', conv.title, conv.created)
    for (const m of conv.messages) {
      if (m.type === 'user') consider(conv, 'user', m.text, m.ts)
      else if (m.type === 'assistant') consider(conv, 'assistant', m.text, m.ts)
    }
  }
  const results = [...best.values()]
    .sort((a, b) => a.ts - b.ts)
    .slice(0, lim)
  return { count: best.size, results }
}

/** Compact transcript from the in-memory (jsonl-backed) messages. */
function readTranscript(id) {
  const conv = ensureLoaded(id)
  if (!conv) return { error: `no conversation with id ${id}` }
  const lines = []
  let total = 0
  let truncated = false
  for (const m of conv.messages) {
    if (m.type !== 'user' && m.type !== 'assistant') continue
    let text = String(m.text || '').replace(/\s+/g, ' ').trim()
    if (text.length > LINE_CAP) text = text.slice(0, LINE_CAP) + '…'
    if (!text) continue
    const line = `${m.type === 'user' ? 'user' : 'assistant'}: ${text}`
    if (total + line.length + 1 > PAYLOAD_CAP) {
      truncated = true
      break
    }
    lines.push(line)
    total += line.length + 1
  }
  return { id: conv.id, title: conv.title, truncated, text: lines.join('\n') }
}

/**
 * The sessions tool. args: { action, query?, id?, limit? }
 * Returns a JSON string (the LLM reads this).
 */
export async function sessionsTool(args) {
  const action = args?.action
  if (action === 'search') {
    const query = String(args.query || '')
    if (query.trim().length < 3)
      return JSON.stringify({ error: 'search requires a "query" of at least 3 characters' })
    const { count, results, error } = searchResults(query, args.limit)
    // count 0 is a valid answer: "not in past chats".
    return JSON.stringify({ count, results, ...(error ? { error } : {}) })
  }
  if (action === 'read') {
    const id = String(args.id || '')
    if (!/^[0-9a-f-]{36}$/i.test(id))
      return JSON.stringify({ error: 'read requires a valid conversation "id" (36-char uuid)' })
    return JSON.stringify(readTranscript(id))
  }
  return JSON.stringify({ error: `unknown action "${action}" — use "search" or "read"` })
}

export const sessionsSchema = {
  type: 'function',
  function: {
    name: 'sessions',
    description:
      'Search or read the operator\'s past chat sessions stored on this machine. ' +
      'Use search first, read only when you need the full context of a conversation. ' +
      'When you answer from a past session, link to it: ' +
      '[conversation title](/chat/<id>) or ' +
      '[conversation title](/chat/<id>#<heading-slug>) for a specific heading ' +
      '(slug rule: lowercase, punctuation stripped, spaces → hyphens).',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['search', 'read'] },
        query: { type: 'string', description: 'Substring to search for in past sessions (action "search", at least 3 characters).' },
        id: { type: 'string', description: 'Conversation uuid to read (action "read").' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Maximum number of search results (default 10, max 20).' },
      },
      required: ['action'],
    },
  },
}
