// Markdown export generation.
// Format matches the exported conversations under /volumes/DATA/conversations:
//
//   # Title
//
//   ## user
//   YYYY-MM-DD-HH-MM-SS
//
//   text
//
//   ## assistant
//   YYYY-MM-DD-HH-MM-SS
//
//   text

export function stamp(ts) {
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

export function exportMarkdown(conv) {
  let out = `# ${conv.title}\n\n`
  for (const m of conv.messages) {
    if (m.type === 'user') out += `## user\n${stamp(m.ts)}\n\n${(m.text || '').trim()}\n\n`
    else if (m.type === 'assistant') out += `## assistant\n${stamp(m.ts)}\n\n${(m.text || '').trim()}\n\n`
  }
  return out
}

export function exportFilename(conv) {
  const slug = conv.title
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
  return `${stamp(conv.created)}_${slug || 'conversation'}.md`
}
