// Mobile notifications, no cloud involved.
// In-page path: Web Notifications API when the page is hidden (another app in
// front). Background path: the service worker (public/sw.js) holds its own
// websocket to the same local server and shows an OS-level notification when
// the browser is backgrounded — works on Android Chrome over https.
let asked = false

export function armNotifications() {
  if (!('Notification' in window)) return
  if (Notification.permission === 'granted') return
  const ask = () => {
    if (!asked && Notification.permission === 'default') {
      asked = true
      Notification.requestPermission().catch(() => {})
    }
    document.removeEventListener('pointerdown', ask, true)
  }
  document.addEventListener('pointerdown', ask, true)
}

export function notifyAgentMessage(title, body, convId) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return
  try {
    const n = new Notification(title || 'chat-agent', {
      body: firstLine(body, 160),
      tag: `conv-${convId}`,
      icon: '/icon.svg',
      renotify: true,
      requireInteraction: true,
    })
    n.onclick = () => {
      try {
        window.focus()
        location.href = `/chat/${convId}`
      } catch {
        /* noop */
      }
      n.close()
    }
    n.show?.()
    navigator.vibrate?.([120, 80, 120])
  } catch {
    /* notifications blocked */
  }
}

function firstLine(s, max) {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}
