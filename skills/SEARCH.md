# SEARCH — using the `pagetest` tool to look things up online

You have one tool: `pagetest`. It drives a real Chrome browser (the page-test
daemon on the host machine). Use it whenever you need information you do not
know for sure: current events, documentation, facts, prices, releases — and
for images.

## Actions

### 1. Web search — `action: "search"`

```json
{ "action": "search", "query": "caddyfile tls internal", "engine": "brave" }
```

- `query` — 3 to 8 keywords, not a full sentence.
- `engine` — optional. `brave` (default, search.brave.com), `google`,
  `duckduckgo`, `wikipedia`, or `google-images` for pictures.
- Returns JSON: `{ engine, count, results: [{ title, url, snippet }] }`.
  For `google-images`: `results: [{ title, src, link }]`.
- Brave sometimes shows a bot check ("Verifying you're not a bot") to
  automated browsers; the tool clicks Verify automatically. If you still get
  `count: 0` from brave, retry with `google` or `duckduckgo`.

Good queries: `rust tokio time crate`, `vllm qwen3 tool calling`,
`caddy automatic https internal`, `m3 macbook battery replacement cost`.

### 2. Read a page — `action: "fetch"`

```json
{ "action": "fetch", "url": "https://example.com/article" }
```

Navigate to a page and return its visible text as `{ title, url, text }`
(truncated to 6000 chars). Use it on the single best result from a search
when the snippet alone is not enough.

### 3. Screenshot — `action: "screenshot"`

```json
{ "action": "screenshot" }
```

Capture the page currently loaded in the browser tab. Returns the PNG file
path.

## Workflow

1. Start with `search` on `brave`. Keep the query short.
2. Read the `snippet` fields first — they often already contain the answer.
3. If you need more detail, `fetch` the single best `url`.
4. For images: `search` with `engine: "google-images"`, then list a few of
   the results (`title`, `src`, `link`) in your answer.
5. If an engine returns `count: 0` or an error, retry with a different engine
   (brave → google → duckduckgo).
6. Answer only from what you actually saw in the results. Cite the source
   urls. Do not invent facts that were not in the results.

## Limits and etiquette

- At most 2–3 tool calls per answer: one search, maybe one fetch. Done.
- Do not search for things you already know (definitions, stable facts,
  simple math).
- Your answer is rendered in a small mobile web view: keep it short, use
  markdown lists, no wide tables.
- Never put urls or shell/script text into `query`.
