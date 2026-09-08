// Usage stats line: ↑39M ↓286k 66.4%/524k
// 1) tokens sent (prompt)  2) tokens received (completion)
// 3) % of context used (last prompt vs context window)  4) context window (k)
//
// %/k colors: <=20% red, <=50% yellow, <=75% white, <=100% green.

export function fmtTokens(n) {
  n = Number(n) || 0
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`
  return String(Math.round(n))
}

export function contextPct(meta) {
  if (!meta?.ctx) return 0
  return ((meta.lastPromptTokens || 0) / meta.ctx) * 100
}

export function statHtml(meta) {
  if (!meta) return ''
  const pct = contextPct(meta)
  const cls = pct <= 20 ? 'st-red' : pct <= 50 ? 'st-yellow' : pct <= 75 ? 'st-white' : 'st-green'
  return (
    `↑${fmtTokens(meta.usage?.prompt)} ↓${fmtTokens(meta.usage?.completion)} ` +
    `<span class="${cls}">${pct.toFixed(1)}%/${fmtTokens(meta.ctx)}</span>`
  )
}
