import hljs from '/vendor/highlight-core.js'
import langJavascript from '/vendor/hljs/javascript.js'
import langTypescript from '/vendor/hljs/typescript.js'
import langJson from '/vendor/hljs/json.js'
import langPython from '/vendor/hljs/python.js'
import langBash from '/vendor/hljs/bash.js'
import langShell from '/vendor/hljs/shell.js'
import langMarkdown from '/vendor/hljs/markdown.js'
import langCss from '/vendor/hljs/css.js'
import langXml from '/vendor/hljs/xml.js'
import langYaml from '/vendor/hljs/yaml.js'
import langSql from '/vendor/hljs/sql.js'
import langGo from '/vendor/hljs/go.js'
import langRust from '/vendor/hljs/rust.js'
import langC from '/vendor/hljs/c.js'
import langCpp from '/vendor/hljs/cpp.js'
import langJava from '/vendor/hljs/java.js'
import langRuby from '/vendor/hljs/ruby.js'
import langPhp from '/vendor/hljs/php.js'
import langSwift from '/vendor/hljs/swift.js'
import langKotlin from '/vendor/hljs/kotlin.js'
import langDiff from '/vendor/hljs/diff.js'
import langDockerfile from '/vendor/hljs/dockerfile.js'
import { slugify } from './slug.js'

for (const [name, def] of Object.entries({
  javascript: langJavascript,
  typescript: langTypescript,
  json: langJson,
  python: langPython,
  bash: langBash,
  shell: langShell,
  markdown: langMarkdown,
  css: langCss,
  xml: langXml,
  yaml: langYaml,
  sql: langSql,
  go: langGo,
  rust: langRust,
  c: langC,
  cpp: langCpp,
  java: langJava,
  ruby: langRuby,
  php: langPhp,
  swift: langSwift,
  kotlin: langKotlin,
  diff: langDiff,
  dockerfile: langDockerfile,
})) {
  try {
    hljs.registerLanguage(name, def)
  } catch {
    /* language missing in this hljs version — skip */
  }
}

export const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Conversation deep links: /chat/<uuid> with an optional #heading anchor.
// They stay in-app (data-local) instead of opening in a new tab.
const LOCAL_LINK_RE = /^\/chat\/[0-9a-f-]{36}(#[0-9a-zA-Z0-9-]+)?$/i

function linkTag(href, text) {
  return LOCAL_LINK_RE.test(href)
    ? `<a href="${href}" data-local="1">${text}</a>`
    : `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`
}

/** Inline markdown on already-escaped text. Protects urls/code spans first. */
function inline(raw) {
  let s = esc(raw)
  const stash = []
  const keep = (html) => {
    stash.push(html)
    return `\u0000${stash.length - 1}\u0000`
  }
  s = s.replace(/https?:\/\/[^\s<>"'`)\]]+/g, (u) => keep(u))
  s = s.replace(/\/chat\/[0-9a-f-]{36}(?![0-9a-f-])(?:#[0-9a-zA-Z0-9-]+)?/g, (u) => keep(u))
  s = s.replace(/`([^`]+)`/g, (_, c) => keep(`<code>${c}</code>`))
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  s = s.replace(/(^|[^_])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>')
  s = s.replace(/\[([^\]]+)\]\(\u0000(\d+)\u0000\)/g, (_, t, i) => linkTag(stash[Number(i)], t))
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => {
    const v = stash[Number(i)]
    return v.startsWith('<code>') ? v : linkTag(v, v)
  })
  return s
}

function codeBlock(code, lang) {
  let inner
  if (lang && hljs.getLanguage(lang)) {
    inner = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
  } else {
    inner = esc(code)
  }
  return (
    `<div class="codeblock"><div class="codebar"><span>${esc(lang || 'text')}</span>` +
    `<button class="copycode" data-enc="${encodeURIComponent(code)}">⧉ copy</button></div>` +
    `<pre class="hljs"><code>${inner}</code></pre></div>`
  )
}

/** Block-level markdown -> HTML. Safe: everything is escaped; only whitelisted tags come out.
 *  scope — the owning message id; prefixes heading ids so they are unique
 *  page-wide (assistant bodies always pass it; without it, headings get no
 *  anchor). */
export function renderMarkdown(src, scope) {
  const lines = String(src ?? '').replace(/\r\n/g, '\n').split('\n')
  const html = []
  let para = []
  const headingCounts = new Map() // base slug -> times seen in this message
  const nextHeadingId = (text) => {
    const base = slugify(text)
    const n = headingCounts.get(base) || 0
    headingCounts.set(base, n + 1)
    return n === 0 ? `${scope}-${base}` : `${scope}-${base}-${n}`
  }
  const flush = () => {
    if (para.length) {
      html.push(`<p>${inline(para.join(' '))}</p>`)
      para = []
    }
  }
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const fence = line.match(/^```(\S*)\s*$/)
    if (fence) {
      flush()
      const lang = fence[1]
      const buf = []
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++])
      i++
      html.push(codeBlock(buf.join('\n'), lang))
      continue
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      flush()
      const l = h[1].length
      if (scope) {
        // GitHub-style anchor: unique id (repeats de-duped within the
        // message) plus a hover link; clicking it just sets the hash — the
        // nearest scrollable ancestor (#messages) scrolls the heading into
        // view.
        const id = nextHeadingId(h[2])
        html.push(`<h${l} id="${id}">${inline(h[2])}<a class="anchor" href="#${id}" aria-label="Link to this heading">¶</a></h${l}>`)
      } else {
        html.push(`<h${l}>${inline(h[2])}</h${l}>`)
      }
      i++
      continue
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flush()
      html.push('<hr>')
      i++
      continue
    }
    const bq = line.match(/^>\s?(.*)$/)
    if (bq) {
      flush()
      const buf = [bq[1]]
      i++
      while (i < lines.length) {
        const m = lines[i].match(/^>\s?(.*)$/)
        if (!m) break
        buf.push(m[1])
        i++
      }
      html.push(`<blockquote><p>${inline(buf.join(' '))}</p></blockquote>`)
      continue
    }
    const ul = line.match(/^\s*[-*]\s+(.*)$/)
    if (ul) {
      flush()
      const buf = [ul[1]]
      i++
      while (i < lines.length) {
        const m = lines[i].match(/^\s*[-*]\s+(.*)$/)
        if (!m) break
        buf.push(m[1])
        i++
      }
      html.push(`<ul>${buf.map((t) => `<li>${inline(t)}</li>`).join('')}</ul>`)
      continue
    }
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (ol) {
      flush()
      const buf = [ol[1]]
      i++
      while (i < lines.length) {
        const m = lines[i].match(/^\s*\d+[.)]\s+(.*)$/)
        if (!m) break
        buf.push(m[1])
        i++
      }
      html.push(`<ol>${buf.map((t) => `<li>${inline(t)}</li>`).join('')}</ol>`)
      continue
    }
    if (line.trim() === '') {
      flush()
      i++
      continue
    }
    para.push(line)
    i++
  }
  flush()
  return html.join('\n')
}
