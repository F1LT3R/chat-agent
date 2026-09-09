import { renderMarkdown, esc } from './md.js'
import { statHtml } from './stats.js'

export { esc }

// How much of the reasoning text the thinking box shows while collapsed.
const THINK_PREVIEW_CHARS = 200

const $ = (s) => document.querySelector(s)

export function renderStats(meta) {
  $('#stats').innerHTML = meta ? statHtml(meta) : ''
}

export function renderList(items, currentId) {
  const ul = $('#conv-list')
  ul.innerHTML = ''
  for (const c of items) {
    const li = document.createElement('li')
    li.className = 'conv' + (c.id === currentId ? ' active' : '')
    li.dataset.id = c.id
    // The conversation item is a real <button> so keyboard and screen
    // reader users can open it; the rename control is a sibling button
    // (nested interactive elements are invalid).
    const open = document.createElement('button')
    open.className = 'conv-open'
    if (c.id === currentId) open.setAttribute('aria-current', 'true')
    const title = document.createElement('span')
    title.className = 'conv-title'
    title.textContent = c.title
    title.title = c.title
    const sub = document.createElement('span')
    sub.className = 'conv-sub'
    sub.textContent = c.preview ? `${fmtTime(c.updated)} · ${c.preview}` : fmtTime(c.updated)
    open.append(title, sub)
    const rename = document.createElement('button')
    rename.className = 'conv-rename'
    rename.textContent = '✎'
    rename.title = 'Rename conversation'
    rename.setAttribute('aria-label', `Rename conversation: ${c.title}`)
    li.append(open, rename)
    ul.append(li)
  }
}

function fmtTime(ts) {
  const d = new Date(ts)
  return (
    d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  )
}

/** A user or assistant message as a DOM node. */
export function buildMessage(item) {
  const wrap = document.createElement('div')
  wrap.className = `msg ${item.type === 'user' ? 'user' : 'assistant'}`
  wrap.dataset.id = item.id
  const bubble = document.createElement('div')
  bubble.className = 'bubble'
  if (item.type === 'user') {
    const t = document.createElement('div')
    t.className = 'mdtext'
    t.textContent = item.text
    bubble.append(t)
  } else {
    const body = document.createElement('div')
    body.className = 'abody'
    if (item.reasoning) {
      const t = thinkEl()
      t._reasoning = item.reasoning
      renderThinkText(t)
      body.append(t)
    }
    const tools = document.createElement('div')
    tools.className = 'tools'
    tools.innerHTML = (item.tools ?? []).map(toolChipHtml).join('')
    const md = document.createElement('div')
    md.className = 'md'
    md.innerHTML = item.text ? renderMarkdown(item.text, item.id) : '<span class="pending">…</span>'
    body.append(tools, md)
    bubble.append(body)
  }
  const copy = document.createElement('button')
  copy.className = 'copymsg'
  copy.dataset.id = item.id
  copy.title = 'Copy message'
  copy.setAttribute('aria-label', 'Copy message')
  copy.textContent = '⧉'
  bubble.append(copy)
  wrap.append(bubble)
  return wrap
}

/** The reasoning box: collapsed it shows the first THINK_PREVIEW_CHARS of
 *  the thinking plus an ellipsis; the summary's arrow expands the full
 *  text so the user can watch the agent think (live while it streams). */
function thinkEl() {
  const d = document.createElement('details')
  d.className = 'think'
  const s = document.createElement('summary')
  s.textContent = 'thinking'
  const pre = document.createElement('pre')
  // The expanded reasoning can exceed max-height and scroll — a scrollable
  // region must be keyboard-focusable (2.1.1).
  pre.tabIndex = 0
  d.append(s, pre)
  d.addEventListener('toggle', () => renderThinkText(d))
  return d
}

function renderThinkText(d) {
  const full = d._reasoning || ''
  const pre = d.querySelector('pre')
  pre.textContent =
    d.open || full.length <= THINK_PREVIEW_CHARS ? full : full.slice(0, THINK_PREVIEW_CHARS) + '…'
}

/** Live-update the streaming parts of an assistant bubble (text + thinking). */
export function updateAssistantContent(item, abody) {
  const md = abody.querySelector('.md')
  if (md) md.innerHTML = item.text ? renderMarkdown(item.text, item.id) : '<span class="pending">…</span>'
  let think = abody.querySelector('.think')
  if (item.reasoning) {
    if (!think) {
      think = thinkEl()
      abody.prepend(think)
    }
    think._reasoning = item.reasoning
    renderThinkText(think)
  } else if (think) {
    think.remove()
  }
}

/** Rebuild the tool chips row (called only on tool events / hydration). */
export function renderAssistantTools(item, abody) {
  let tools = abody.querySelector('.tools')
  if (!tools) {
    tools = document.createElement('div')
    tools.className = 'tools'
    abody.append(tools)
  }
  tools.innerHTML = (item.tools ?? []).map(toolChipHtml).join('')
}

function toolChipHtml(t) {
  const args = t.args ?? {}
  let label
  if (t.name === 'pagetest' || args.action) {
    if (args.action === 'search') {
      label = `search "${args.query || ''}"${args.engine && args.engine !== 'brave' ? ` (${args.engine})` : ''}`
    } else if (args.action === 'fetch') {
      label = `fetch ${args.url || ''}`
    } else if (args.action === 'screenshot') {
      label = 'screenshot'
    } else label = args.action || (t.name || 'tool')
  } else label = t.name || 'tool'
  const status = t.status === 'start' || t.status === 'running' ? '…' : t.status === 'error' ? '✗' : '✓'
  const statusWord = t.status === 'start' || t.status === 'running' ? 'running' : t.status === 'error' ? 'failed' : 'done'
  const dur = t.durationMs ? ` · ${Math.round(t.durationMs / 100) / 10}s` : ''
  return (
    `<details class="tool"><summary>` +
    `<span class="tname">🔍 ${esc(t.name || 'tool')}</span>` +
    `<span class="tlab">${esc(label.slice(0, 90))}</span>` +
    `<span class="tst">${status}${dur}<span class="visually-hidden"> ${statusWord}</span></span>` +
    `</summary>` +
    (t.result ? `<pre class="tres" tabindex="0">${esc(t.result)}</pre>` : '') +
    `</details>`
  )
}

export function buildErrorNote(text, kind) {
  const d = document.createElement('div')
  d.className = 'msg system'
  const b = document.createElement('div')
  b.className = `err-note${kind ? ` ${kind}` : ''}`
  b.textContent = text
  d.append(b)
  return d
}

export function emptyStateEl() {
  const d = document.createElement('div')
  d.className = 'empty'
  d.append(
    h('h2', 'No conversations yet'),
    h('p', 'Pick a chat from the panel or start a new one.'),
  )
  const btn = document.createElement('button')
  btn.id = 'empty-new'
  btn.textContent = '＋ New chat'
  d.append(btn)
  return d
}

function h(tag, text) {
  const el = document.createElement(tag)
  el.textContent = text
  return el
}
