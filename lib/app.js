import { ChatSocket } from './ws.js'
import {
  buildMessage,
  buildErrorNote,
  emptyStateEl,
  renderAssistantTools,
  renderList,
  renderStats,
  updateAssistantContent,
} from './ui.js'
import { armNotifications, notifyAgentMessage } from './notify.js'

const $ = (s) => document.querySelector(s)
const UUID_RE = /^[0-9a-f-]{36}$/i

const state = {
  metas: new Map(), // id -> conversation meta
  current: null, // current conversation id (null = home)
  items: [], // display items of the current conversation
  ws: new ChatSocket(),
  streaming: new Map(), // messageId -> { item, abody }
  lastAssistant: new Map(), // conversationId -> messageId
  turnActive: false,
  panelOpen: false,
}

/* ---------------- conversation list ---------------- */

function allMetas() {
  return [...state.metas.values()].sort((a, b) => b.updated - a.updated)
}

function renderListNow() {
  renderList(allMetas(), state.current)
}

function upsertMeta(m) {
  const meta = m?.conversation
  if (!meta) return
  state.metas.set(meta.id, meta)
  renderListNow()
  if (state.current === meta.id) {
    renderStats(meta)
    $('#chat-title').textContent = meta.title
    setThinkBtn(meta.thinking !== false)
  }
}

/* ---------------- routing (browser history) ---------------- */

async function openConversation(id, push) {
  if (!UUID_RE.test(id) || !state.metas.has(id) && !(await exists(id))) return
  state.current = id
  state.items = []
  state.streaming.clear()
  state.turnActive = false
  setSendMode()
  const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`)
  if (!res.ok) return
  const data = await res.json()
  upsertMeta({ conversation: data.meta })
  state.items = hydrate(data.messages)
  const box = $('#messages')
  box.innerHTML = ''
  for (const it of state.items) box.append(buildMessage(it))
  $('#chat-title').textContent = data.meta.title
  renderStats(data.meta)
  setThinkBtn(data.meta.thinking !== false)
  if (push) history.pushState({}, '', `/chat/${id}`)
  closePanel()
  scrollBottom(true)
}

async function exists(id) {
  try {
    const r = await fetch(`/api/conversations/${encodeURIComponent(id)}`)
    return r.ok
  } catch {
    return false
  }
}

function goHome(push) {
  const list = allMetas()
  if (list.length) {
    openConversation(list[0].id, push)
    return
  }
  state.current = null
  state.items = []
  state.streaming.clear()
  setSendMode()
  const box = $('#messages')
  box.innerHTML = ''
  box.append(emptyStateEl())
  $('#chat-title').textContent = 'New Chat'
  renderStats(null)
  setThinkBtn(false)
  if (push) history.pushState({}, '', '/')
}

function routeFromLocation() {
  const m = location.pathname.match(/^\/chat\/([0-9a-f-]{36})$/i)
  if (m) openConversation(m[1], false)
  else goHome(false)
}

window.addEventListener('popstate', () => routeFromLocation())

/* ---------------- session history -> display items ---------------- */

function hydrate(messages) {
  const items = []
  for (const m of messages) {
    if (m.type === 'user') items.push(m)
    else if (m.type === 'assistant') {
      items.push({ ...m, tools: [] })
    } else if (m.type === 'tool') {
      const a = [...items].reverse().find((x) => x.type === 'assistant' && x.toolCalls?.some((t) => t.id === m.callId))
      if (a) a.tools.push({ name: m.tool, args: m.args, status: m.status, result: m.result, durationMs: m.durationMs })
    }
  }
  return items
}

/* ---------------- websocket events ---------------- */

function onHello(m) {
  state.metas = new Map((m.conversations || []).map((c) => [c.id, c]))
  renderListNow()
  routeFromLocation()
}

function onMsg(m) {
  if (state.current !== m.conversationId) return
  state.items.push(m.message)
  appendDom(buildMessage(m.message))
  scrollBottom(true)
}

function onAssistantStart(m) {
  if (state.current !== m.conversationId) return
  const item = { type: 'assistant', id: m.messageId, ts: Date.now(), text: '', reasoning: '', toolCalls: [], tools: [] }
  state.items.push(item)
  const el = buildMessage(item)
  appendDom(el)
  const abody = el.querySelector('.abody')
  state.streaming.set(m.messageId, { item, abody })
  state.lastAssistant.set(m.conversationId, m.messageId)
  state.turnActive = true
  setSendMode()
  scrollBottom(true)
}

function onToken(m) {
  if (state.current !== m.conversationId) return
  const s = state.streaming.get(m.messageId)
  if (!s) return
  if (m.kind === 'reasoning') s.item.reasoning += m.delta
  else s.item.text += m.delta
  pendingRenders.add(s)
  if (!rafId) rafId = requestAnimationFrame(flushRenders)
}

function onTool(m) {
  if (state.current !== m.conversationId) return
  const aid = state.lastAssistant.get(m.conversationId)
  const item = state.items.find((x) => x.id === aid)
  const abody = state.streaming.get(aid)?.abody
  if (!item || !abody) return
  if (m.status === 'start') {
    item.tools.push({ name: m.tool, args: m.args, status: 'running' })
  } else {
    const key = JSON.stringify(m.args ?? {})
    const existing = [...item.tools].reverse().find((t) => JSON.stringify(t.args ?? {}) === key)
    if (existing) Object.assign(existing, { status: m.status, result: m.result, durationMs: m.durationMs })
    else item.tools.push({ name: m.tool, args: m.args, status: m.status, result: m.result, durationMs: m.durationMs })
  }
  renderAssistantTools(item, abody)
}

function onTurnDone(m) {
  if (m.meta) upsertMeta({ conversation: m.meta })
  if (state.current === m.conversationId) {
    state.turnActive = false
    setSendMode()
    // Auto-scroll to the fresh answer only when the user did not read/
    // scroll during the turn (mousedown/touchstart anywhere on the page).
    if (!turnInteracted) {
      const box = $('#messages')
      box.scrollTop = box.scrollHeight
    }
  }
  state.streaming.clear()
  if (m.text) notifyAgentMessage(m.title, m.text, m.conversationId)
}

function onTurnStart(m) {
  if (m.conversationId === state.current) {
    state.turnActive = true
    turnInteracted = false
    setSendMode()
  }
}

function onError(m) {
  if (m.conversationId && state.current !== m.conversationId) return
  state.turnActive = false
  setSendMode()
  if (m.message === 'stopped') {
    appendDom(buildErrorNote('■ stopped', 'soft'))
  } else if (m.message) {
    appendDom(buildErrorNote(m.message))
  }
}

/* ---------------- streaming render batching ---------------- */

const pendingRenders = new Set()
let rafId = 0
// Interaction tracking for streaming scroll: a mousedown/touchdown while
// the current turn is streaming marks it; turn-done then leaves the view
// where the user put it instead of snapping to the bottom.
let turnInteracted = false
function flushRenders() {
  rafId = 0
  // No programmatic scroll while a turn streams — the user reads freely.
  for (const s of pendingRenders) updateAssistantContent(s.item, s.abody)
  pendingRenders.clear()
}

/* ---------------- dom helpers ---------------- */

function appendDom(el) {
  const box = $('#messages')
  const empty = box.querySelector('.empty')
  if (empty) empty.remove()
  box.append(el)
}

function scrollBottom(force) {
  const box = $('#messages')
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 140
  if (force || near) box.scrollTop = box.scrollHeight
}

function setSendMode() {
  const b = $('#send')
  b.textContent = state.turnActive ? '■' : '➤'
  b.title = state.turnActive ? 'Stop generating' : 'Send'
}

function setThinkBtn(on) {
  const b = $('#think-btn')
  b.classList.toggle('on', !!on)
  b.title = `Thinking mode: ${on ? 'on' : 'off'}`
  b.disabled = false
}

function closePanel() {
  if (window.matchMedia('(max-width: 860px)').matches) setPanelOpen(false)
}

function setPanelOpen(open) {
  state.panelOpen = open
  $('#app').classList.toggle('panel-open', open)
  $('#scrim').hidden = !open
}

/* ---------------- actions ---------------- */

async function trySend() {
  const input = $('#input')
  const text = input.value.trim()
  if (!text) return
  let convId = state.current
  if (!convId) {
    const res = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    const { conversation } = await res.json()
    upsertMeta({ conversation })
    await openConversation(conversation.id, true)
    convId = conversation.id
  }
  if (!state.ws.send({ type: 'chat', conversationId: convId, text })) return
  input.value = ''
  autosize()
}

async function newChat() {
  const res = await fetch('/api/conversations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  const { conversation } = await res.json()
  upsertMeta({ conversation })
  await openConversation(conversation.id, true)
  $('#input').focus()
}

async function copyText(t) {
  try {
    await navigator.clipboard.writeText(t)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = t
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.append(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
}

function flash(btn) {
  const old = btn.textContent
  btn.textContent = '✓'
  setTimeout(() => (btn.textContent = old), 900)
}

function autosize() {
  const t = $('#input')
  t.style.height = 'auto'
  t.style.height = `${Math.min(t.scrollHeight, 160)}px`
}

/* ---------------- ui wiring ---------------- */

function bindUi() {
  // One permanent pair of passive listeners: any press (page body or
  // scrollbar) while a turn is streaming counts as user interaction.
  const markInteracted = () => {
    if (state.turnActive) turnInteracted = true
  }
  document.addEventListener('mousedown', markInteracted, { passive: true })
  document.addEventListener('touchstart', markInteracted, { passive: true })
  $('#send').addEventListener('click', () => {
    if (state.turnActive) {
      if (state.current) state.ws.send({ type: 'stop', conversationId: state.current })
    } else {
      trySend()
    }
  })
  const input = $('#input')
  input.addEventListener('input', autosize)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      trySend()
    }
  })
  $('#new-chat').addEventListener('click', newChat)
  $('#panel-toggle').addEventListener('click', () => setPanelOpen(!state.panelOpen))
  $('#scrim').addEventListener('click', () => setPanelOpen(false))
  $('#export-btn').addEventListener('click', () => {
    if (!state.current) return
    location.href = `/api/conversations/${state.current}/export`
  })
  $('#think-btn').addEventListener('click', async () => {
    if (!state.current) return
    const cur = state.metas.get(state.current)?.thinking !== false
    const res = await fetch(`/api/conversations/${state.current}/thinking`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ on: !cur }),
    })
    if (res.ok) upsertMeta(await res.json())
  })
  $('#messages').addEventListener('click', (e) => {
    if (e.target.id === 'empty-new') {
      newChat()
      return
    }
  })

  // copy buttons (per message + per code block), anywhere
  document.addEventListener('click', async (e) => {
    const cc = e.target.closest('.copycode')
    if (cc) {
      await copyText(decodeURIComponent(cc.dataset.enc || ''))
      flash(cc)
      return
    }
    const cm = e.target.closest('.copymsg')
    if (cm) {
      const item = state.items.find((x) => x.id === cm.dataset.id)
      await copyText(item?.text ?? '')
      flash(cm)
    }
  })

  // conversation list: open / rename
  $('#conv-list').addEventListener('click', (e) => {
    const li = e.target.closest('.conv')
    if (!li) return
    if (e.target.closest('.conv-rename')) {
      startRename(li)
      return
    }
    if (li.dataset.id) openConversation(li.dataset.id, true)
  })
}

function startRename(li) {
  const titleEl = li.querySelector('.conv-title')
  if (!titleEl || li.querySelector('input')) return
  const id = li.dataset.id
  const input = document.createElement('input')
  input.className = 'conv-title-input'
  input.value = state.metas.get(id)?.title || ''
  titleEl.replaceWith(input)
  input.focus()
  input.select()
  let done = false
  const finish = async (save) => {
    if (done) return
    done = true
    if (save && input.value.trim()) {
      const res = await fetch(`/api/conversations/${id}/rename`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: input.value }),
      })
      if (res.ok) upsertMeta(await res.json())
    }
    renderListNow()
    if (state.current === id) $('#chat-title').textContent = state.metas.get(id)?.title || ''
  }
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') finish(true)
    if (ev.key === 'Escape') finish(false)
  })
  input.addEventListener('blur', () => finish(true))
}

/* ---------------- init ---------------- */

function registerServiceWorker() {
  const ok =
    location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  if ('serviceWorker' in navigator && ok) navigator.serviceWorker.register('/sw.js').catch(() => {})
}

function init() {
  const ws = state.ws
  ws.on('hello-ack', onHello)
  ws.on('conv-created', upsertMeta)
  ws.on('conv-meta', upsertMeta)
  ws.on('msg', onMsg)
  ws.on('assistant-start', onAssistantStart)
  ws.on('token', onToken)
  ws.on('tool', onTool)
  ws.on('turn-done', onTurnDone)
  ws.on('turn-start', onTurnStart)
  ws.on('error', onError)
  ws.on('close', () => {
    $('#stats').insertAdjacentHTML('beforeend', '<span class="st-red"> · ws reconnecting…</span>')
  })
  ws.on('open', () => {
    const s = $('#stats')
    const span = s.querySelector('.st-red')
    if (span?.textContent.includes('reconnecting')) span.remove()
  })
  ws.connect()
  armNotifications()
  registerServiceWorker()
  bindUi()
  setSendMode()
  // Default: panel open on wide viewports, closed on narrow.
  state.panelOpen = window.matchMedia('(min-width: 861px)').matches
  setPanelOpen(state.panelOpen)
  autosize()
  routeFromLocation()
}

init()
