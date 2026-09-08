import { config } from './config.js'

/**
 * One streaming chat-completions call against the local OpenAI-compatible
 * endpoint. Yields:
 *   { type: 'content', delta }        visible assistant text
 *   { type: 'reasoning', delta }      model thinking (qwen3 reasoning_content)
 *   { type: 'done', content, reasoning, toolCalls, usage }
 * Throws on HTTP errors or abort (AbortError).
 */
export async function* streamChat({ messages, tools, signal }) {
  const res = await fetch(`${config.model.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.model.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model.id,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: config.requestMaxTokens,
      ...(tools && tools.length ? { tools } : {}),
    }),
    signal,
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`LLM HTTP ${res.status}: ${body.slice(0, 400)}`)
  }

  let content = ''
  let reasoning = ''
  const toolCalls = new Map() // stream index -> { id, name, arguments }
  let usage = null

  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') continue
      let json
      try {
        json = JSON.parse(data)
      } catch {
        continue
      }
      if (json.usage) usage = json.usage
      const delta = json.choices?.[0]?.delta
      if (!delta) continue
      if (delta.reasoning_content) {
        reasoning += delta.reasoning_content
        yield { type: 'reasoning', delta: delta.reasoning_content }
      }
      if (delta.content) {
        content += delta.content
        yield { type: 'content', delta: delta.content }
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const slot = toolCalls.get(tc.index) ?? { id: '', name: '', arguments: '' }
          if (tc.id) slot.id = tc.id
          if (tc.function?.name) slot.name = tc.function.name
          if (tc.function?.arguments) slot.arguments += tc.function.arguments
          toolCalls.set(tc.index, slot)
        }
      }
    }
  }

  const calls = [...toolCalls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([i, t]) => ({
      id: t.id || `call_${i}`,
      type: 'function',
      function: { name: t.name, arguments: t.arguments },
    }))
  yield { type: 'done', content, reasoning, toolCalls: calls, usage }
}
