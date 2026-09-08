import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Agent model, resolved from the pi models file. Default target:
// provider "s2-qwen-3.8-256k", model "qwen-3.8b-256k" (local OpenAI-compatible).
const PROVIDER = process.env.CHAT_AGENT_PROVIDER || 's2-qwen-3.8-256k'
const MODEL_ID = process.env.CHAT_AGENT_MODEL || 'qwen-3.8b-256k'
const MODELS_FILE = process.env.MODELS_JSON || path.join(os.homedir(), '.pi', 'agent', 'models.json')

function loadModel() {
  const raw = JSON.parse(fs.readFileSync(MODELS_FILE, 'utf8'))
  const provider = raw.providers?.[PROVIDER]
  if (!provider) throw new Error(`provider "${PROVIDER}" not found in ${MODELS_FILE}`)
  const model = provider.models.find((m) => m.id === MODEL_ID) ?? provider.models[0]
  if (!model) throw new Error(`model "${MODEL_ID}" not found under provider "${PROVIDER}"`)
  return {
    id: model.id,
    baseUrl: provider.baseUrl.replace(/\/+$/, ''),
    apiKey: provider.apiKey === 'none' ? 'none' : provider.apiKey,
    contextWindow: model.contextWindow ?? 128000,
    maxTokens: model.maxTokens ?? 8192,
  }
}

export const config = {
  model: loadModel(),
  // Normal mode: node binds loopback only; Caddy owns 0.0.0.0:4242 and
  // terminates TLS in front of it. --http mode (dev fallback): plain HTTP
  // on 0.0.0.0:4242 with no TLS.
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 4243),
  sessionsDir: path.resolve('sessions'),
  tmpDir: path.resolve('tmp'),
  skillsDir: path.resolve('skills'),
  // Max LLM->tool->LLM rounds per turn.
  maxToolRounds: 8,
  // vLLM's OpenAI-compatible default for max_tokens is 16 when omitted,
  // so this is always set explicitly.
  requestMaxTokens: 8192,
}
