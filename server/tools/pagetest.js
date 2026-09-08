import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'

// The agent's web access. Every action drives the page-test CLI daemon
// (a persistent Chrome tab) via short-lived CLI invocations.
const DAEMON = 'chat-agent'
const BIN = process.env.PAGE_TEST_BIN || 'page-test'
const RESULT_CAP = 24000

function runCmd(args, { timeoutMs = 60000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(BIN, args, { cwd: process.cwd() })
    let out = ''
    let err = ''
    let settled = false
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }, timeoutMs)
    const finish = (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, out, err })
    }
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', () => finish(-1))
    child.on('close', (code) => finish(code ?? -1))
  })
}

let ensurePromise = null
async function ensureDaemon() {
  // Idempotent. ensure --url keeps the window pointed at a real page until
  // the first search navigates it (page-test usage rule).
  ensurePromise ??= runCmd(
    ['ensure', DAEMON, '--size', '1280,720', '--url', 'https://search.brave.com'],
    { timeoutMs: 60000 },
  )
  try {
    const r = await ensurePromise
    if (r.code !== 0) throw new Error(`page-test ensure failed: ${(r.err || r.out).trim().slice(0, 300)}`)
  } catch (e) {
    ensurePromise = null // allow a retry next time
    throw e
  }
}

/** Navigate to a URL and run an extraction script (page or cdp mode). */
async function runPageOnce({ url, script, timeoutMs = 45000, mode = 'page' }) {
  const dir = path.join(config.tmpDir, 'pagetest')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `run-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.js`)
  fs.writeFileSync(file, script)
  const r = await runCmd(
    ['run', DAEMON, '--url', url, '--mode', mode, '--file', file, '--timeout', String(timeoutMs)],
    { timeoutMs: timeoutMs + 20000 },
  )
  let json = null
  const s = (r.out || '').trim()
  try {
    json = JSON.parse(s)
  } catch {
    const i = s.indexOf('{')
    if (i >= 0) {
      try {
        json = JSON.parse(s.slice(i))
      } catch {
        /* no json in stdout */
      }
    }
  }
  if (r.code !== 0 || !json || json.status !== 'done') {
    const msg = json?.error || json?.status || `exit ${r.code}: ${((r.err || r.out).trim() || 'no output').slice(0, 500)}`
    return { ok: false, error: String(msg) }
  }
  return { ok: true, result: json.result }
}

// Long-lived daemons can lose their CDP session; recover with one restart.
const DEAD_SESSION_RE = /Session with given id not found|not running|no reply within/i

async function runPage(opts) {
  let r = await runPageOnce(opts)
  if (!r.ok && DEAD_SESSION_RE.test(r.error)) {
    ensurePromise = null
    await runCmd(['stop', DAEMON], { timeoutMs: 15000 })
    await new Promise((res) => setTimeout(res, 1200))
    await ensureDaemon()
    r = await runPageOnce(opts)
  }
  return r
}

const SCRIPTS = {
  brave: `
// cdp mode: brave sometimes shows a "Verifying you're not a bot" interstitial
// to automated browsers. Poll for it and click Verify with a real CDP mouse
// click, then extract the results from the result rows.
const prep = '(() => { const els = Array.from(document.querySelectorAll("button, a, [role=button]")); const b = els.find((x) => /verify/i.test((x.innerText || "") + " " + (x.getAttribute("aria-label") || ""))); if (b) { b.id = "__ct_verify"; try { b.scrollIntoView({ block: "center" }) } catch (e) {} return 1 } return 0 })()'
let clicks = 0
for (let i = 0; i < 10; i++) {
  let v = 0
  try {
    v = await evaluate(prep)
  } catch (e) {
    break
  }
  if (!v) break
  try {
    await click('#__ct_verify')
    clicks += 1
  } catch (e) {
    break
  }
  await sleep(1500)
}
const extract = '(() => { const seen = new Set(); const items = []; const scope = document.querySelector(".serp-columns-main") || document; const host = location.hostname; for (const a of scope.querySelectorAll("a[href]")) { if (!a.closest(".result-content, .result-wrapper, .result-body, .snippet, .g, .web-result")) continue; const url = a.href; if (!url || !url.startsWith("http") || seen.has(url)) continue; if (url.indexOf(host) !== -1) continue; const title = (a.innerText || "").replace(/\\s+/g, " ").trim(); if (title.length < 12 || title.length > 200) continue; const box = a.closest(".result-content, .result-wrapper, .result-body, .snippet, .g, .web-result"); const snippet = (box ? box.innerText : title).replace(/\\s+/g, " ").trim().slice(0, 300); seen.add(url); items.push({ title: title.slice(0, 120), url: url, snippet: snippet }); if (items.length >= 8) break } return JSON.stringify({ engine: "brave", page: document.title, count: items.length, results: items, note: items.length ? "" : "no results parsed (possible bot check - tap Verify in the chat-agent browser window) - try engine google or duckduckgo" }) })()'
const out = await evaluate(extract)
return JSON.stringify({ clicks: clicks, result: out })
`,
  google: `
const seen = new Set()
const items = []
for (const h of document.querySelectorAll('#search h3')) {
  const a = h.closest('a[href]') || h.parentElement?.closest('a[href]')
  if (!a || !a.href || !a.href.startsWith('http') || seen.has(a.href)) continue
  seen.add(a.href)
  const box = h.closest('[data-sokoban-container]') || h.closest('[data-attr-class]') || h.parentElement
  const snippet = (box?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 300)
  items.push({ title: h.innerText.trim(), url: a.href, snippet })
  if (items.length >= 8) break
}
return JSON.stringify({ engine: 'google', page: document.title, count: items.length, results: items, note: items.length ? '' : 'no results parsed — page may be a consent/redirect page; try engine "brave" or "duckduckgo"' })
`,
  'google-images': `
const seen = new Set()
const items = []
for (const img of document.images) {
  if (!img.src || img.naturalWidth < 60 || seen.has(img.src)) continue
  if (!/^https?:/.test(img.src)) continue
  seen.add(img.src)
  items.push({ title: (img.alt || img.title || '').slice(0, 120), src: img.src, link: img.closest('a')?.href || '' })
  if (items.length >= 12) break
}
return JSON.stringify({ engine: 'google-images', count: items.length, results: items, note: 'src = google thumbnail url (openable in a browser); link = source page when present' })
`,
  duckduckgo: `
const items = []
for (const r of document.querySelectorAll('.web-result, .result')) {
  const a = r.querySelector('a.result__a')
  const sn = r.querySelector('.result__snippet')
  if (!a) continue
  items.push({ title: a.innerText.trim(), url: a.href, snippet: (sn?.innerText || '').trim().slice(0, 300) })
  if (items.length >= 8) break
}
return JSON.stringify({ engine: 'duckduckgo', count: items.length, results: items })
`,
  wikipedia: `
const p = location.pathname
const q = decodeURIComponent(p.startsWith('/wiki/') ? p.slice(6) : p)
const r = await fetch('/api/rest_v1/page/summary/' + encodeURIComponent(q), { headers: { accept: 'application/json' } })
if (!r.ok) return JSON.stringify({ engine: 'wikipedia', count: 0, results: [], note: 'no summary for that title; try the exact article name' })
const j = await r.json()
return JSON.stringify({ engine: 'wikipedia', count: 1, results: [{ title: j.title, snippet: j.extract || '', url: (j.content_urls?.desktop?.page) || '' }] })
`,
  fetch: `
return JSON.stringify({ title: document.title, url: location.href, text: (document.body?.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim().slice(0, 6000) })
`,
}

const ENGINES = {
  brave: { url: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}`, script: SCRIPTS.brave, mode: 'cdp', timeoutMs: 60000 },
  google: { url: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}&num=10`, script: SCRIPTS.google },
  'google-images': { url: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}&tbm=isch`, script: SCRIPTS['google-images'] },
  duckduckgo: { url: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, script: SCRIPTS.duckduckgo },
  wikipedia: { url: (q) => `https://en.wikipedia.org/wiki/${encodeURIComponent(q)}`, script: SCRIPTS.wikipedia },
}

/**
 * The single agent-facing tool. args: { action, query?, engine?, url? }
 * Returns a string (the LLM reads this).
 */
export async function pagetestTool(args) {
  const action = args?.action
  if (action === 'search') {
    const query = String(args.query || '').trim()
    if (!query) return 'search requires a non-empty "query" (3-8 words)'
    const engine = ENGINES[args.engine] ? args.engine : 'brave'
    await ensureDaemon()
    const res = await runPage({ url: ENGINES[engine].url(query), script: ENGINES[engine].script, mode: ENGINES[engine].mode, timeoutMs: ENGINES[engine].timeoutMs })
    if (!res.ok) return `search failed: ${res.error.slice(0, 800)}`
    let out = String(res.result ?? '')
    if (engine === 'brave') {
      // brave script wraps the payload: { clicks, result: "<json>" }
      try {
        const j = JSON.parse(out)
        if (j && typeof j.result === 'string') out = j.result
      } catch {
        /* plain payload */
      }
    }
    return out.slice(0, RESULT_CAP)
  }
  if (action === 'fetch') {
    let u
    try {
      u = new URL(String(args.url || ''))
    } catch {
      return 'fetch requires an absolute http(s) "url"'
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'fetch only supports http(s) urls'
    await ensureDaemon()
    const res = await runPage({ url: u.toString(), script: SCRIPTS.fetch })
    if (!res.ok) return `fetch failed: ${res.error.slice(0, 800)}`
    return String(res.result ?? '').slice(0, RESULT_CAP)
  }
  if (action === 'screenshot') {
    await ensureDaemon()
    const out = path.join(config.tmpDir, 'pagetest', `shot-${Date.now()}.png`)
    fs.mkdirSync(path.dirname(out), { recursive: true })
    const r = await runCmd(['screenshot', DAEMON, '--out', out], { timeoutMs: 30000 })
    return r.code === 0 ? `screenshot saved: ${out}` : `screenshot failed: ${(r.err || r.out).trim().slice(0, 300)}`
  }
  return `unknown action "${action}" — use "search", "fetch" or "screenshot"`
}

export const pagetestSchema = {
  type: 'function',
  function: {
    name: 'pagetest',
    description:
      'Drive a real browser (the page-test daemon) to search the web or read pages. ' +
      'action "search" runs a web/image search on search.brave.com, google.com, html.duckduckgo.com, ' +
      'en.wikipedia.org or images.google.com; action "fetch" navigates to a url and returns its visible text; ' +
      'action "screenshot" captures the currently loaded page as a PNG.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['search', 'fetch', 'screenshot'] },
        query: { type: 'string', description: 'Search query (action "search"). Keep to 3-8 keywords.' },
        engine: {
          type: 'string',
          enum: ['brave', 'google', 'google-images', 'duckduckgo', 'wikipedia'],
          description: 'Search engine, default "brave". Use "google-images" for pictures.',
        },
        url: { type: 'string', description: 'Absolute http(s) url to read (action "fetch").' },
      },
      required: ['action'],
    },
  },
}
