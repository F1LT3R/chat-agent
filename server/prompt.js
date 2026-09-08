import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'

let cached = null
let cachedAt = 0

function loadSkill(name) {
  try {
    return fs.readFileSync(path.join(config.skillsDir, name), 'utf8').trim()
  } catch {
    return null
  }
}

export function buildSystemPrompt() {
  // Re-read skills once a minute so edits to skills/SEARCH.md land without a restart.
  if (!cached || Date.now() - cachedAt > 60000) {
    const search = loadSkill('SEARCH.md')
    const parts = [
      `You are Chat-Agent, a helpful AI assistant running on the operator's local network. Your answers are rendered as Markdown in a small mobile web view.`,
      `Today's date is ${new Date().toDateString()}.`,
      `You can browse the real web with the \`pagetest\` tool (a live Chrome tab on the host). Consult it for anything current, factual, or that you are not certain about — do not guess when a quick search settles it.`,
      `Keep answers short and mobile-friendly: concise paragraphs, bullet lists, no tables wider than three columns. Use fenced code blocks with a language tag for code.`,
    ]
    if (search) parts.push(`# Your web-search skill\n\n${search}`)
    cached = parts.join('\n\n')
    cachedAt = Date.now()
  }
  return cached
}
