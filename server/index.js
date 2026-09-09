import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { WebSocketServer } from 'ws'
import { config } from './config.js'
import * as store from './conversations.js'

const httpMode = process.argv.includes('--http')
const host = httpMode ? '0.0.0.0' : config.host
const port = httpMode ? 4242 : config.port

const PUB = path.resolve('public')
const LIB = path.resolve('lib')
const NM = path.resolve('node_modules')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
}

function safeJoin(base, urlPath) {
  const p = path.normalize(path.join(base, decodeURIComponent(urlPath)))
  return p === base || p.startsWith(base + path.sep) ? p : null
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(obj))
}

function sendFile(res, file, type) {
  fs.readFile(file, (err, buf) => {
    if (err) return sendJson(res, 404, { error: 'not found' })
    res.writeHead(200, { 'content-type': type || MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' })
    res.end(buf)
  })
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (d) => {
      data += d
      if (data.length > 1e6) {
        reject(new Error('body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (!data) return resolve({})
      try {
        resolve(JSON.parse(data))
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

/* ---------------- HTTP API ---------------- */

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts[1] !== 'conversations') return sendJson(res, 404, { error: 'not found' })
  if (parts.length === 2) {
    if (req.method === 'GET') return sendJson(res, 200, { conversations: store.listConversations() })
    if (req.method === 'POST') {
      const body = await readBody(req)
      const conv = store.createConversation(body.title)
      return sendJson(res, 201, { conversation: store.metaOf(conv) })
    }
  }
  const id = decodeURIComponent(parts[2] || '')
  const conv = store.ensureLoaded(id)
  if (!conv) return sendJson(res, 404, { error: 'conversation not found' })

  if (parts[3] === 'rename' && req.method === 'POST') {
    const body = await readBody(req)
    const r = store.renameConversation(id, body.title)
    return r ? sendJson(res, 200, { conversation: store.metaOf(r) }) : sendJson(res, 404, { error: 'not found' })
  }
  if (parts[3] === 'thinking' && req.method === 'POST') {
    const body = await readBody(req)
    const r = store.setThinking(id, body.on)
    if (r) {
      broadcast({ type: 'conv-meta', conversation: store.metaOf(r) })
      return sendJson(res, 200, { conversation: store.metaOf(r) })
    }
    return sendJson(res, 404, { error: 'not found' })
  }
  if (parts[3] === 'export') {
    // Regenerate the markdown from the session, then serve the actual file.
    const file = path.join(config.sessionsDir, `${id}.md`)
    fs.writeFileSync(file, store.exportMarkdown(conv))
    res.writeHead(200, {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename="${store.exportFilename(conv)}"`,
      'cache-control': 'no-store',
    })
    return res.end(fs.readFileSync(file))
  }
  if (!parts[3] && req.method === 'GET') {
    return sendJson(res, 200, { meta: store.metaOf(conv), messages: conv.messages })
  }
  sendJson(res, 404, { error: 'not found' })
}

/* ---------------- static files ---------------- */

function handleStatic(req, res, url) {
  if (url.pathname === '/' || url.pathname === '/index.html') return sendFile(res, path.join(PUB, 'index.html'))
  if (url.pathname.startsWith('/lib/')) {
    const f = safeJoin(LIB, url.pathname.slice('/lib/'.length))
    return f ? (fs.existsSync(f) ? sendFile(res, f) : sendJson(res, 404, { error: 'not found' })) : sendJson(res, 400, { error: 'bad path' })
  }
  if (url.pathname === '/vendor/highlight-github-dark.css') {
    const f = path.join(NM, 'highlight.js', 'styles', 'github-dark.css')
    return fs.existsSync(f) ? sendFile(res, f) : sendJson(res, 404, { error: 'not found' })
  }
  if (url.pathname === '/vendor/highlight-core.js') {
    // highlight.js ships a CJS core; shim the single module.exports line so
    // the browser can import it natively as ESM.
    const core = fs.readFileSync(path.join(NM, 'highlight.js', 'lib', 'core.js'), 'utf8')
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
    return res.end(core.replace('module.exports = highlight;', 'export default highlight;'))
  }
  if (url.pathname.startsWith('/vendor/hljs/')) {
    const lang = path.basename(url.pathname).replace(/\.js$/, '')
    const f = path.join(NM, 'highlight.js', 'es', 'languages', `${lang}.js`)
    return fs.existsSync(f) ? sendFile(res, f) : sendJson(res, 404, { error: 'language not found' })
  }
  const f = safeJoin(PUB, url.pathname.slice(1))
  if (f && fs.existsSync(f)) return sendFile(res, f)
  // SPA fallback: client-side routes like /chat/<uuid> serve the app shell
  // so deep links and refreshes work.
  if (req.method === 'GET' && !path.extname(url.pathname)) {
    return sendFile(res, path.join(PUB, 'index.html'))
  }
  sendJson(res, 404, { error: 'not found' })
}

/* ---------------- websocket ---------------- */

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((e) => sendJson(res, 500, { error: e.message }))
    return
  }
  if (url.pathname === '/healthz') {
    sendJson(res, 200, { ok: true, model: config.model.id, mode: httpMode ? 'http-dev' : 'caddy-tls' })
    return
  }
  handleStatic(req, res, url)
})

const wss = new WebSocketServer({ server, path: '/ws' })
const clients = new Set()

// All connected clients (web tabs, service workers, other devices on the LAN)
// receive every event; each client filters by conversationId.
function broadcast(evt) {
  const s = JSON.stringify(evt)
  for (const c of clients) if (c.readyState === 1) c.send(s)
}

function handleClientMessage(ws, msg) {
  try {
    if (msg?.type === 'hello') {
      ws.send(JSON.stringify({ type: 'hello-ack', conversations: store.listConversations() }))
      return
    }
    if (msg?.type === 'get-history') {
      const conv = store.ensureLoaded(String(msg.conversationId || ''))
      if (conv) {
        ws.send(JSON.stringify({ type: 'history', conversationId: conv.id, meta: store.metaOf(conv), messages: conv.messages }))
      }
      return
    }
    if (msg?.type === 'stop') {
      store.stopTurn(String(msg.conversationId || ''))
      return
    }
    if (msg?.type === 'chat') {
      const text = String(msg.text || '').trim()
      if (!text) return
      let conv = msg.conversationId ? store.ensureLoaded(String(msg.conversationId)) : null
      if (!conv) {
        conv = store.createConversation()
        broadcast({ type: 'conv-created', conversation: store.metaOf(conv) })
      }
      if (!store.startTurn(conv, text, broadcast)) {
        ws.send(JSON.stringify({ type: 'error', conversationId: conv.id, message: 'a turn is already running in this conversation' }))
        return
      }
      ws.send(JSON.stringify({ type: 'chat-ack', conversationId: conv.id }))
    }
  } catch (e) {
    ws.send(JSON.stringify({ type: 'error', message: e.message }))
  }
}

wss.on('connection', (ws) => {
  clients.add(ws)
  ws.send(JSON.stringify({ type: 'hello-ack', conversations: store.listConversations() }))
  ws.on('message', (raw) => {
    let m
    try {
      m = JSON.parse(String(raw))
    } catch {
      return
    }
    handleClientMessage(ws, m)
  })
  const drop = () => clients.delete(ws)
  ws.on('close', drop)
  ws.on('error', drop)
})

/* ---------------- edge (0.0.0.0:4242) ----------------
 * Owns the public port in normal (caddy-tls) mode. Sniffs the first byte
 * of each connection:
 *  - TLS ClientHello (0x16) -> raw TCP pipe to Caddy, which terminates TLS
 *    on 127.0.0.1:4443. WebSockets (wss) pass through untouched.
 *  - Plain HTTP             -> 301 to the same https URL, so browsers
 *    never see "Client sent an HTTP request to an HTTPS server."
 */
const CADDY_TLS = { host: '127.0.0.1', port: 4443 }

function startEdge() {
  const edge = net.createServer((client) => {
    client.once('data', (d) => {
      if (d.length === 0) return
      if (d[0] === 0x16) {
        const upstream = net.connect(CADDY_TLS.port, CADDY_TLS.host)
        upstream.once('connect', () => {
          upstream.write(d) // replay the bytes already consumed
          client.pipe(upstream)
          upstream.pipe(client)
        })
        upstream.on('error', () => client.destroy())
        client.on('error', () => upstream.destroy())
        return
      }
      // Plain HTTP: read the request head, then redirect to https.
      let acc = d
      const reply = () => {
        try {
          const end = Math.max(acc.indexOf('\r\n\r\n'), 0)
          const headStr = acc.subarray(0, end).toString('latin1').toLowerCase()
          const m = /host:\s*([^\r\n]+)/.exec(headStr)
          let hostH = m ? m[1].trim() : 'localhost:4242'
          if (!/:\d+$/.test(hostH)) hostH += ':4242'
          const target = headStr.split('\n')[0]?.split(' ')[1] || '/'
          client.write(
            `HTTP/1.1 301 Moved Permanently\r\nLocation: https://${hostH}${target}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`,
          )
          client.end()
        } catch (e) {
          client.destroy()
        }
      }
      if (acc.includes('\r\n\r\n')) reply()
      else {
        client.on('data', (ch) => {
          acc = Buffer.concat([acc, ch])
          if (acc.includes('\r\n\r\n')) reply()
        })
        setTimeout(() => client.destroy(), 5000).unref()
      }
    })
    client.on('error', () => {})
  })
  edge.listen(4242, '0.0.0.0', () => {
    console.log(`[chat-agent] edge on 0.0.0.0:4242 — TLS piped to Caddy 127.0.0.1:4443, plain HTTP -> 301 https`)
  })
  edge.on('error', (e) => console.error(`[chat-agent] edge failed to bind 4242: ${e.message}`))
}

if (!httpMode) startEdge()

server.listen(port, host, () => {
  console.log(
    httpMode
      ? `[chat-agent] plain HTTP dev mode on http://${host}:${port} (no TLS — run Caddy for the real thing)`
      : `[chat-agent] node API on http://${host}:${port} — TLS chain: edge 0.0.0.0:4242 -> Caddy 127.0.0.1:4443`,
  )
  console.log(`[chat-agent] model: ${config.model.id} @ ${config.model.baseUrl} (ctx ${config.model.contextWindow})`)
})
