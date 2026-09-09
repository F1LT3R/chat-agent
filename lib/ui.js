import { renderMarkdown, esc } from './md.js'
import { statHtml } from './stats.js'

export { esc }

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
    const title = document.createElement('div')
    title.className = 'conv-title'
    title.textContent = c.title
    title.title = c.title
    const sub = document.createElement('div')
    sub.className = 'conv-sub'
    sub.textContent = c.preview ? `${fmtTime(c.updated)} · ${c.preview}` : fmtTime(c.updated)
    const rename = document.createElement('button')
    rename.className = 'conv-rename'
    rename.textContent = '✎'
    rename.title = 'Rename conversation'
    li.append(title, sub, rename)
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
    if (item.reasoning) body.append(thinkEl(item.reasoning))
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
  copy.textContent = '⧉'
  bubble.append(copy)
  wrap.append(bubble)
  return wrap
}

function thinkEl(reasoning) {
  const d = document.createElement('details')
  d.className = 'think'
  const s = document.createElement('summary')
  s.textContent = 'thinking'
  const pre = document.createElement('pre')
  pre.textContent = reasoning
  d.append(s, pre)
  return d
}

/** Live-update the streaming parts of an assistant bubble (text + thinking). */
export function updateAssistantContent(item, abody) {
  const md = abody.querySelector('.md')
  if (md) md.innerHTML = item.text ? renderMarkdown(item.text, item.id) : '<span class="pending">…</span>'
  let think = abody.querySelector('.think')
  if (item.reasoning) {
    if (!think) {
      think = thinkEl('')
      abody.prepend(think)
    }
    think.querySelector('pre').textContent = item.reasoning
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
  const dur = t.durationMs ? ` · ${Math.round(t.durationMs / 100) / 10}s` : ''
  return (
    `<details class="tool"><summary>` +
    `<span class="tname">🔍 ${esc(t.name || 'tool')}</span>` +
    `<span class="tlab">${esc(label.slice(0, 90))}</span>` +
    `<span class="tst">${status}${dur}</span>` +
    `</summary>` +
    (t.result ? `<pre class="tres">${esc(t.result)}</pre>` : '') +
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
