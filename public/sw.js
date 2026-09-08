/* chat-agent service worker.
 *
 * Keeps its own websocket to the same local server open, so a new agent
 * message reaches the phone as an OS-level notification even when the
 * browser app is backgrounded. No cloud, no push service, no sign-up —
 * everything stays on the local network over https.
 */
const RETRY_BASE = 2000
let ws = null
let retry = 0

// Only notify when nobody is actively looking at the app in a browser
// window (focused browser = no popup).
async function userIsLooking() {
	try {
		const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
		return list.some((c) => c.visibilityState === 'visible')
	} catch {
		return true // fail safe: don't spam
	}
}

function connect() {
	const proto = location.protocol === 'https:' ? 'wss' : 'ws'
	ws = new WebSocket(`${proto}://${location.host}/ws`)
	ws.onopen = () => {
		retry = 0
	}
	ws.onmessage = async (ev) => {
		let m
		try {
			m = JSON.parse(ev.data)
		} catch {
			return
		}
		if (m.type === 'turn-done' && m.text) {
			if (await userIsLooking()) return
			const body = String(m.text).replace(/\s+/g, ' ').trim()
			self.registration.showNotification(m.title || 'chat-agent', {
				body: body.length > 160 ? `${body.slice(0, 160)}…` : body,
				icon: '/icon.svg',
				badge: '/icon.svg',
				tag: `conv-${m.conversationId}`,
				renotify: true,
				requireInteraction: true,
				data: { url: `/chat/${m.conversationId}` },
			})
		}
	}
	ws.onclose = () => {
		retry += 1
		setTimeout(connect, Math.min(30000, RETRY_BASE * 2 ** Math.min(retry, 4)))
	}
	ws.onerror = () => ws.close()
}

self.addEventListener('install', (e) => e.waitUntil(self.skipWaiting()))
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
connect()

self.addEventListener('notificationclick', (e) => {
	const url = e.notification.data?.url || '/'
	e.notification.close()
	e.waitUntil(
		self.clients
			.matchAll({ type: 'window', includeUncontrolled: true })
			.then((list) => {
				for (const c of list) {
					c.navigate(url)
					return c.focus()
				}
				return self.clients.openWindow(url)
			}),
	)
})
