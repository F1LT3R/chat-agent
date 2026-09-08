// Start the full stack: node API (127.0.0.1:4243) + Caddy TLS (0.0.0.0:4242).
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

const children = [
  spawn(process.execPath, ['server/index.js'], { cwd: root, stdio: 'inherit', env: process.env }),
  spawn('caddy', ['run', '--config', 'Caddyfile', '--adapter', 'caddyfile'], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  }),
]

console.log('[start-all] node + caddy starting — open https://<host-ip>:4242/')

const stop = (code = 0) => {
  for (const c of children) {
    try {
      c.kill('SIGTERM')
    } catch {
      /* noop */
    }
  }
  setTimeout(() => process.exit(code), 500)
}

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
for (const c of children) {
  c.on('exit', (code) => {
    if (code !== 0 && code !== null) console.error(`[start-all] child exited with code ${code} — stopping stack`)
  })
}
