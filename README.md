# chat-agent

Mobile-first AI chat for the local network. A Node.js backend serves the web
app over **HTTPS** (Caddy TLS front on `0.0.0.0:4242`), talks to a local
OpenAI-compatible LLM — `qwen-3.8b-256k` from `~/.pi/agent/models.json`
(provider `s2-qwen-3.8-256k` @ `http://spark-two:8000/v1`) — and lets the agent
search the real web through the `page-test` browser daemon.

## Layout

- `server/` — Node.js backend (ESM): HTTP API, WebSocket hub, agent loop,
  OpenAI-compatible streaming client, `pagetest` tool
- `public/` — web assets: `index.html`, `style.css`, `sw.js` (notifications),
  `icon.svg`
- `lib/` — the chat app (browser ES modules): `app.js`, `ui.js`, `ws.js`,
  `md.js` (markdown + highlight.js), `stats.js`, `notify.js`
- `sessions/` — one conversation = `<uuid>.jsonl` (session log) + `<uuid>.md`
  (markdown export, regenerated after every turn); the UI renders from these
- `skills/SEARCH.md` — skill injected into the system prompt that teaches the
  agent how to search the web with the `pagetest` tool
- `Caddyfile` — TLS front (Caddy), reverse-proxy + websocket pass-through to
  the node process
- `scripts/start-all.mjs` — runs node + caddy together
- `scripts/cert.sh` — issues the local leaf cert from Caddy's internal CA
  (written to `certs/`, git-ignored)

## Run

```bash
npm install
npm run start:all    # node on 127.0.0.1:4243 + caddy TLS on 0.0.0.0:4242
```

Then open `https://<host-ip>:4242/` from the phone or desktop browser (same
LAN). Find the host IP with `ipconfig getifaddr en0` (macOS).

Dev without TLS: `npm run dev` (node listens plain HTTP on `0.0.0.0:4242`).

### Certificate & trusting it

Caddy serves TLS on `0.0.0.0:4242`. A LAN address has no public domain, so the
leaf certificate is issued from **Caddy's own internal CA** (the local CA that
Caddy maintains in its storage — still fully local, no public CA, no cloud).
`scripts/cert.sh` signs `certs/chat-agent.crt` with that CA for the SANs
`127.0.0.1`, `localhost` and the machine's current LAN IP; the Caddyfile
serves it:

```bash
sh scripts/cert.sh                 # re-issue when the LAN IP changes
pkill -f 'caddy run'; caddy run --config Caddyfile --adapter caddyfile
```

- macOS: Caddy's root CA is normally already trusted by the system (check with
  `curl -v https://127.0.0.1:4242/healthz` — no warning = trusted). If not:
  `security add-trusted-cert -d -r trustRoot -k /Library/Keychains/system.keychain` \
  `"$HOME/Library/Application Support/Caddy/pki/authorities/local/root.crt"` (admin approval needed)
- Android/iPhone: trust the CA once — copy
  `"$HOME/Library/Application Support/Caddy/pki/authorities/local/root.crt"`
to the device and install it (Settings → Security → Install a certificate →
CA certificate). Until then the first visit shows a warning; tap through it.

## Web UI features

- Collapsible left panel with the chat list; inline rename (✎); `＋` creates a
  new conversation UUID + `/chat/<uuid>` endpoint
- Copy button on every user and assistant turn (plus per-code-block copy)
- highlight.js syntax highlighting for code blocks in agent responses
- Mobile-sized layout, pinch/drag-zoom left enabled by the browser
- Usage stats line: `↑39M ↓286k 66.4%/524k` — tokens sent, tokens received,
  % of context used (last prompt vs 262144-token window), context window in k.
  The `%/k` part is colored: red ≤ 20%, yellow ≤ 50%, white ≤ 75%, green ≤ 100%
- Browser history: every conversation switch and `＋` does `pushState`, so the
  back button walks `/` ↔ `/chat/<uuid>` history; deep links open directly
- Export: `⤓` button or `GET /api/conversations/<id>/export` serves the real
  markdown file generated from the session, in the format of
  `/volumes/DATA/conversations` (`# Title` / `## user` / `## assistant` with
  `YYYY-MM-DD-HH-MM-SS` stamps), downloaded as `<stamp>_<title>.md`
- Notifications without any cloud: Web Notifications when the page is hidden,
  plus a service worker (`public/sw.js`) that holds its own websocket to the
  local server and shows an OS-level notification when the browser is
  backgrounded (Android Chrome, over https). Tap a notification to jump to
  the conversation.

## Protocol

Web ↔ node is WebSocket only (multi-connection: every tab, service worker and
device on the LAN can connect to `/ws` simultaneously; events are broadcast to
all of them).

Client → server: `hello`, `chat {conversationId?, text}`, `stop
{conversationId}`, `get-history {conversationId}`.

Server → client: `hello-ack {conversations[]}`, `conv-created` / `conv-meta
{conversation}`, `msg {conversationId, message}` (user turn), `turn-start`,
`assistant-start {messageId}`, `token {messageId, kind: content|reasoning,
delta}`, `tool {name, args, status: start|done|error, result?}`, `turn-done
{meta, text}`, `error`.

HTTP API (same origin, for state and export): `GET /api/conversations`,
`POST /api/conversations`, `GET /api/conversations/:id`,
`POST /api/conversations/:id/rename`, `GET /api/conversations/:id/export`,
`GET /healthz`.

## The agent's web access

The only agent tool is `pagetest` (implemented in
`server/tools/pagetest.js`): a `page-test` daemon named `chat-agent` runs a
persistent Chrome tab. `action: "search"` navigates to search.brave.com,
google.com, html.duckduckgo.com, en.wikipedia.org or images.google.com and
extracts `{title, url, snippet}` results; `action: "fetch"` reads a page's
visible text; `action: "screenshot"` saves the current page as PNG under
`tmp/pagetest/`. `skills/SEARCH.md` (auto-injected into the system prompt)
teaches the model when and how to use it.

## Notes

- Sessions persist across restarts; conversations are reloaded from
  `sessions/*.jsonl` on startup and on first access.
- vLLM's OpenAI-compatible default `max_tokens` is 16 when omitted, so the
  server always sends `max_tokens: 8192` explicitly.
- Caddy proxies websockets natively (HTTP/1.1 upgrade pass-through), so no
  special Caddy config is needed beyond the reverse proxy.
