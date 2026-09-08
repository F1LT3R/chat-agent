import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { streamChat } from './llm.js'
import { buildSystemPrompt } from './prompt.js'
import { exportFilename, exportMarkdown } from './markdown.js'
import { pagetestSchema, pagetestTool } from './tools/pagetest.js'

const dir = config.sessionsDir
fs.mkdirSync(dir, { recursive: true })

/** id -> { id, title, created, updated, model, ctx, usage {prompt, completion}, lastPromptTokens, messages[] } */
export const conversations = new Map()
const running = new Map() // id -> AbortController

const uid = (p) => `${p}-${crypto.randomBytes(6).toString('hex')}`
const RESULT_CAP = 24000
const sessionFile = (id) => path.join(dir, `${id}.jsonl`)
const markdownFile = (id) => path.join(dir, `${id}.md`)
const safeParse = (s) => {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

/* ---------------- persistence ---------------- */

function appendLine(conv, obj) {
  fs.appendFileSync(sessionFile(conv.id), `${JSON.stringify(obj)}\n`)
}

function writeMeta(conv) {
  const meta = {
    type: 'meta',
    id: conv.id,
    title: conv.title,
    created: conv.created,
    model: conv.model,
    ctx: conv.ctx,
    thinking: conv.thinking !== false,
  }
  const lines = fs.existsSync(sessionFile(conv.id))
    ? fs
        .readFileSync(sessionFile(conv.id), 'utf8')
        .split('\n')
        .filter((l) => l && !l.startsWith('{"type":"meta"'))
    : []
  fs.writeFileSync(sessionFile(conv.id), [JSON.stringify(meta), ...lines].join('\n') + '\n')
}

function regenMarkdown(conv) {
  fs.writeFileSync(markdownFile(conv.id), exportMarkdown(conv))
}

function pushMessage(conv, m) {
  conv.messages.push(m)
  appendLine(conv, m)
  conv.updated = m.ts
}

/* ---------------- load / create / api ---------------- */

export function loadConversation(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const file = sessionFile(id)
  if (!fs.existsSync(file)) return null
  const conv = {
    id,
    title: 'Chat',
    created: Date.parse('2000-01-01'),
    updated: 0,
    model: config.model.id,
    ctx: config.model.contextWindow,
    thinking: true,
    usage: { prompt: 0, completion: 0 },
    lastPromptTokens: 0,
    messages: [],
  }
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue
    let j
    try {
      j = JSON.parse(line)
    } catch {
      continue
    }
    if (j.type === 'meta') {
      Object.assign(conv, { title: j.title, created: j.created, model: j.model, ctx: j.ctx, thinking: j.thinking !== false })
    } else {
      conv.messages.push(j)
      conv.updated = Math.max(conv.updated, j.ts || 0)
      if (j.usage) {
        conv.usage.prompt += j.usage.prompt || 0
        conv.usage.completion += j.usage.completion || 0
        conv.lastPromptTokens = Math.max(conv.lastPromptTokens, j.usage.prompt || 0)
      }
    }
  }
  conversations.set(id, conv)
  return conv
}

export function ensureLoaded(id) {
  return conversations.get(id) ?? loadConversation(id)
}

function lastUserText(conv) {
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    if (conv.messages[i].type === 'user') return (conv.messages[i].text || '').replace(/\s+/g, ' ').slice(0, 60)
  }
  return ''
}

export function metaOf(conv) {
  return {
    id: conv.id,
    title: conv.title,
    created: conv.created,
    updated: conv.updated,
    model: conv.model,
    ctx: conv.ctx,
    thinking: conv.thinking !== false,
    usage: { ...conv.usage },
    lastPromptTokens: conv.lastPromptTokens,
    preview: lastUserText(conv),
  }
}

export function listConversations() {
  for (const file of fs.readdirSync(dir)) {
    if (file.endsWith('.jsonl')) {
      const id = file.slice(0, -6)
      if (!conversations.has(id)) loadConversation(id)
    }
  }
  return [...conversations.values()].sort((a, b) => b.updated - a.updated).map(metaOf)
}

export function createConversation(title) {
  const id = crypto.randomUUID()
  const now = Date.now()
  const conv = {
    id,
    title: title?.trim() || 'New Chat',
    created: now,
    updated: now,
    model: config.model.id,
    ctx: config.model.contextWindow,
    thinking: true,
    usage: { prompt: 0, completion: 0 },
    lastPromptTokens: 0,
    messages: [],
  }
  conversations.set(id, conv)
  writeMeta(conv)
  regenMarkdown(conv)
  return conv
}

export function renameConversation(id, title) {
  const conv = ensureLoaded(id)
  if (!conv) return null
  conv.title = String(title || '').trim().slice(0, 120) || 'New Chat'
  conv.updated = Date.now()
  writeMeta(conv)
  regenMarkdown(conv)
  return conv
}

export function setThinking(id, on) {
  const conv = ensureLoaded(id)
  if (!conv) return null
  conv.thinking = on !== false
  writeMeta(conv)
  return conv
}

export { exportFilename, exportMarkdown }

/* ---------------- the agent turn ---------------- */

function autoTitle(text) {
  const line = text.split('\n').map((l) => l.trim()).find(Boolean) || ''
  const clean = line.replace(/^#+\s*/, '').replace(/[*_`~[\]()]/g, '').slice(0, 48)
  return clean ? clean : 'New Chat'
}

function apiMessagesFor(conv) {
  const out = [{ role: 'system', content: buildSystemPrompt() }]
  for (const m of conv.messages) {
    if (m.type === 'user') out.push({ role: 'user', content: m.text })
    else if (m.type === 'assistant') {
      const mm = { role: 'assistant', content: m.text || null }
      if (m.toolCalls?.length) {
        mm.tool_calls = m.toolCalls.map((t) => ({
          id: t.id,
          type: 'function',
          function: { name: t.name, arguments: JSON.stringify(t.args ?? {}) },
        }))
      }
      out.push(mm)
    } else if (m.type === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.callId, content: m.result || 'error' })
    }
  }
  return out
}

/**
 * Run one full agent turn (user message -> LLM -> tools -> LLM ...).
 * emit(evt) is called for every broadcastable event. Resolves when the
 * turn is fully recorded on disk.
 */
export async function runTurn(conv, userText, emit, externalSignal) {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  externalSignal?.addEventListener('abort', onAbort)
  const signal = controller.signal

  const userMsg = { type: 'user', id: uid('u'), ts: Date.now(), text: userText }
  pushMessage(conv, userMsg)
  if (conv.title === 'New Chat') {
    conv.title = autoTitle(userText)
    writeMeta(conv)
  }
  regenMarkdown(conv)
  emit({ type: 'msg', conversationId: conv.id, message: userMsg })
  emit({ type: 'conv-meta', conversation: metaOf(conv) })
  emit({ type: 'turn-start', conversationId: conv.id })

  const apiMessages = apiMessagesFor(conv)
  const turnUsage = { prompt: 0, completion: 0 }
  let lastPromptTokens = 0
  let finalAssistant = null
  let failed = null

  try {
    for (let round = 0; round <= config.maxToolRounds; round++) {
      const msgId = uid('a')
      emit({ type: 'assistant-start', conversationId: conv.id, messageId: msgId })
      let content = ''
      let reasoning = ''
      let terminal = null
      try {
        for await (const e of streamChat({ messages: apiMessages, tools: [pagetestSchema], signal, thinking: conv.thinking !== false })) {
          if (e.type === 'content') {
            content += e.delta
            emit({ type: 'token', conversationId: conv.id, messageId: msgId, kind: 'content', delta: e.delta })
          } else if (e.type === 'reasoning') {
            reasoning += e.delta
            emit({
              type: 'token',
              conversationId: conv.id,
              messageId: msgId,
              kind: 'reasoning',
              delta: e.delta,
            })
          } else terminal = e
        }
      } catch (err) {
        if (!signal.aborted && err?.name !== 'AbortError') throw err
      }
      const aborted = signal.aborted
      const toolCalls = aborted ? [] : terminal?.toolCalls ?? []
      const usage = terminal?.usage

      if (content || reasoning || toolCalls.length) {
        const assistantMsg = {
          type: 'assistant',
          id: msgId,
          ts: Date.now(),
          text: content,
          usage: { prompt: usage?.prompt_tokens || 0, completion: usage?.completion_tokens || 0 },
        }
        if (reasoning) assistantMsg.reasoning = reasoning
        if (toolCalls.length) {
          assistantMsg.toolCalls = toolCalls.map((t) => ({
            id: t.id,
            name: t.function.name,
            args: safeParse(t.function.arguments) ?? {},
          }))
        }
        if (aborted) assistantMsg.aborted = true
        pushMessage(conv, assistantMsg)
        finalAssistant = assistantMsg
        apiMessages.push({ role: 'assistant', content: content || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) })
        if (usage?.prompt_tokens || usage?.completion_tokens) {
          turnUsage.prompt += usage.prompt_tokens || 0
          turnUsage.completion += usage.completion_tokens || 0
          lastPromptTokens = Math.max(lastPromptTokens, usage.prompt_tokens || 0)
        }
        regenMarkdown(conv)
      }

      if (aborted) {
        emit({ type: 'error', conversationId: conv.id, message: 'stopped' })
        break
      }
      if (!toolCalls.length) break
      if (round === config.maxToolRounds) {
        emit({ type: 'error', conversationId: conv.id, message: 'tool round limit reached' })
        break
      }

      for (const tc of toolCalls) {
        const toolMsg = {
          type: 'tool',
          id: uid('t'),
          callId: tc.id,
          ts: Date.now(),
          tool: tc.function.name,
          args: safeParse(tc.function.arguments) ?? {},
          status: 'done',
          result: '',
        }
        emit({ type: 'tool', conversationId: conv.id, tool: tc.function.name, args: toolMsg.args, status: 'start' })
        const t0 = Date.now()
        try {
          toolMsg.result = String(await pagetestTool(toolMsg.args))
        } catch (e) {
          toolMsg.status = 'error'
          toolMsg.result = `error: ${e.message}`
        }
        toolMsg.durationMs = Date.now() - t0
        toolMsg.result = toolMsg.result.slice(0, RESULT_CAP)
        pushMessage(conv, toolMsg)
        apiMessages.push({ role: 'tool', tool_call_id: tc.id, content: toolMsg.result })
        emit({
          type: 'tool',
          conversationId: conv.id,
          tool: tc.function.name,
          args: toolMsg.args,
          status: toolMsg.status,
          result: toolMsg.result.slice(0, 400),
          durationMs: toolMsg.durationMs,
        })
      }
    }
  } catch (err) {
    failed = err
    emit({ type: 'error', conversationId: conv.id, message: err?.message || String(err) })
  } finally {
    externalSignal?.removeEventListener('abort', onAbort)
    running.delete(conv.id)
  }

  conv.updated = Date.now()
  conv.usage.prompt += turnUsage.prompt
  conv.usage.completion += turnUsage.completion
  conv.lastPromptTokens = Math.max(conv.lastPromptTokens, lastPromptTokens)
  regenMarkdown(conv)
  emit({
    type: 'turn-done',
    conversationId: conv.id,
    messageId: finalAssistant?.id,
    text: (finalAssistant?.text || '').slice(0, 400),
    title: conv.title,
    meta: metaOf(conv),
    failed: failed?.message || null,
  })
}

export function isRunning(id) {
  return running.has(id)
}

/** Start a turn; false if this conversation already has one running. */
export function startTurn(conv, text, emit) {
  if (running.has(conv.id)) return false
  const controller = new AbortController()
  running.set(conv.id, controller)
  runTurn(conv, text, emit, controller.signal).catch((e) =>
    emit({ type: 'error', conversationId: conv.id, message: e.message }),
  )
  return true
}

export function stopTurn(id) {
  running.get(id)?.abort()
}
